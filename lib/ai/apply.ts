import path from "node:path";
import { z } from "zod";

import { buildCommitMessage, commitPaths, dirtyPaths } from "@/lib/git";
import {
  cardRelPath,
  createCardFrom,
  createSnapshot,
  finalizeSnapshot,
  getProject,
  patchCardMeta,
  readAux,
  vaultRoot,
  writeAuxData,
  writeCardBody,
} from "@/lib/vault";

import type { Proposal } from "./types";

/**
 * Apply the accepted parts of a proposal.
 *
 * Order matters and is not negotiable: snapshot first, then write, then commit. A
 * snapshot taken after the fact protects nothing, and a commit taken before the write
 * would record a state that does not exist.
 */

export const SelectionSchema = z.object({
  cards: z.array(z.number().int().min(0)).default([]),
  phases: z.array(z.number().int().min(0)).default([]),
  risks: z.array(z.number().int().min(0)).default([]),
  assumptions: z.array(z.number().int().min(0)).default([]),
  questions: z.array(z.number().int().min(0)).default([]),
});

export type Selection = z.output<typeof SelectionSchema>;

export interface ApplyResult {
  applied: {
    cardsCreated: number;
    cardsUpdated: number;
    phases: number;
    risks: number;
    assumptions: number;
    questions: number;
  };
  rejected: number;
  snapshotId: string;
  /** Vault-relative paths written. */
  touched: string[];
  commit: { ok: boolean; sha?: string; skipped?: string };
}

function pick<T>(items: T[], indices: number[]): { item: T; index: number }[] {
  const wanted = new Set(indices);
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => wanted.has(index));
}

/** `q1`, `q2`… continuing past whatever ids are already in the document. */
function nextIdFactory(prefix: string, existing: unknown[]): () => string {
  let max = 0;
  for (const entry of existing) {
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  let n = max;
  return () => {
    n += 1;
    return `${prefix}${n}`;
  };
}

export async function applyProposal(
  proposal: Proposal,
  selection: Selection,
): Promise<ApplyResult> {
  const slug = proposal.slug;
  const project = await getProject(slug);

  const cards = pick(proposal.cards, selection.cards);
  const phases = pick(proposal.phases, selection.phases);
  const risks = pick(proposal.risks, selection.risks);
  const assumptions = pick(proposal.assumptions, selection.assumptions);
  const questions = pick(proposal.questions, selection.questions);

  const totalSelected =
    cards.length + phases.length + risks.length + assumptions.length + questions.length;
  const totalOffered =
    proposal.cards.length +
    proposal.phases.length +
    proposal.risks.length +
    proposal.assumptions.length +
    proposal.questions.length;

  // ---- work out every file the apply will touch, before touching any of them

  const willCopy = new Set<string>();
  for (const { item } of cards) {
    if (item.op !== "update" || typeof item.id !== "number") continue;
    const rel = await cardRelPath(slug, item.id);
    if (rel) willCopy.add(rel);
  }
  if (phases.length > 0) willCopy.add("roadmap.md");
  if (risks.length > 0 || assumptions.length > 0) willCopy.add("risks.md");
  if (questions.length > 0) willCopy.add("questions.md");

  const snapshotId = await createSnapshot(slug, proposal.runId, [...willCopy]);

  // ---- write

  const created: string[] = [];
  const touched = new Set<string>(willCopy);
  let cardsCreated = 0;
  let cardsUpdated = 0;

  for (const { item } of cards) {
    const body = [item.body.trim(), formatAcceptance(item.acceptance)]
      .filter(Boolean)
      .join("\n\n");

    if (item.op === "create") {
      const card = await createCardFrom(slug, {
        title: item.title,
        column: item.column ?? project.meta.columns[0] ?? "Intake",
        phase: item.phase ?? null,
        priority: item.priority,
        size: item.size,
        confidence: item.confidence,
        body: `\n${body}\n`,
      });
      const rel = `cards/${card.file}`;
      created.push(rel);
      touched.add(rel);
      cardsCreated += 1;
      continue;
    }

    if (typeof item.id !== "number") continue;
    await writeCardBody(slug, item.id, `\n${body}\n`);
    await patchCardMeta(slug, item.id, {
      title: item.title,
      priority: item.priority,
      size: item.size,
      confidence: item.confidence,
      ...(item.phase === undefined ? {} : { phase: item.phase }),
    });
    cardsUpdated += 1;
  }

  if (phases.length > 0) {
    const data = await readAux(slug, "roadmap.md");
    const existing = Array.isArray(data.phases) ? (data.phases as { n?: number }[]) : [];
    const merged = new Map<number, unknown>();
    for (const p of existing) if (typeof p.n === "number") merged.set(p.n, p);
    for (const { item } of phases) merged.set(item.n, item);

    await writeAuxData(slug, "roadmap.md", {
      ...data,
      phases: [...merged.values()].sort(
        (a, b) => ((a as { n: number }).n ?? 0) - ((b as { n: number }).n ?? 0),
      ),
    });
  }

  if (risks.length > 0 || assumptions.length > 0) {
    const data = await readAux(slug, "risks.md");
    const existingRisks = Array.isArray(data.risks) ? (data.risks as unknown[]) : [];
    const existingAssumptions = Array.isArray(data.assumptions)
      ? (data.assumptions as unknown[])
      : [];

    const riskId = nextIdFactory("r", existingRisks);
    const assumptionId = nextIdFactory("a", existingAssumptions);

    await writeAuxData(slug, "risks.md", {
      ...data,
      risks: [
        ...existingRisks,
        ...risks.map(({ item }) => ({
          id: riskId(),
          text: item.text,
          likelihood: item.likelihood,
          impact: item.impact,
          mitigation: item.mitigation,
        })),
      ],
      assumptions: [
        ...existingAssumptions,
        ...assumptions.map(({ item }) => ({
          id: assumptionId(),
          text: item.text,
          validated: false,
        })),
      ],
    });
  }

  if (questions.length > 0) {
    const data = await readAux(slug, "questions.md");
    const existing = Array.isArray(data.questions) ? (data.questions as unknown[]) : [];
    const questionId = nextIdFactory("q", existing);
    const today = new Date().toISOString().slice(0, 10);

    await writeAuxData(slug, "questions.md", {
      ...data,
      questions: [
        ...existing,
        ...questions.map(({ item }) => ({
          id: questionId(),
          text: item.text,
          status: "open",
          answer: null,
          fromRun: proposal.runId,
          created: today,
        })),
      ],
    });
  }

  await finalizeSnapshot(slug, snapshotId, created);

  // ---- commit, which must never be able to fail the apply

  const repoRelative = [...touched].map((rel) => path.posix.join(slug, rel));
  const root = vaultRoot();
  const alreadyDirty = await dirtyPaths(root, repoRelative);

  const accepted: string[] = [];
  if (cardsCreated) accepted.push(`${cardsCreated} card${cardsCreated === 1 ? "" : "s"} created`);
  if (cardsUpdated) accepted.push(`${cardsUpdated} card${cardsUpdated === 1 ? "" : "s"} updated`);
  if (phases.length) accepted.push(`${phases.length} phase${phases.length === 1 ? "" : "s"}`);
  if (risks.length) accepted.push(`${risks.length} risk${risks.length === 1 ? "" : "s"}`);
  if (assumptions.length) accepted.push(`${assumptions.length} assumption(s)`);
  if (questions.length) accepted.push(`${questions.length} question${questions.length === 1 ? "" : "s"}`);

  const commit = await commitPaths(
    root,
    repoRelative,
    buildCommitMessage({
      job: proposal.job,
      runId: proposal.runId,
      summary: proposal.summary,
      accepted,
      rejected: totalOffered - totalSelected,
      dirtyPaths: alreadyDirty,
    }),
  );

  return {
    applied: {
      cardsCreated,
      cardsUpdated,
      phases: phases.length,
      risks: risks.length,
      assumptions: assumptions.length,
      questions: questions.length,
    },
    rejected: totalOffered - totalSelected,
    snapshotId,
    touched: [...touched],
    commit,
  };
}

function formatAcceptance(items: string[]): string {
  if (items.length === 0) return "";
  return ["## Acceptance criteria", "", ...items.map((i) => `- [ ] ${i}`)].join("\n");
}

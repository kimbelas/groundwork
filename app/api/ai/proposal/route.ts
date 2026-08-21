import { z } from "zod";

import { applyProposal, SelectionSchema } from "@/lib/ai/apply";
import { proposalWarnings, verifyGrounding } from "@/lib/ai/grounding";
import { VaultError } from "@/lib/errors";
import { readJson, route } from "@/lib/http";
import { assertRunId, listRuns, readExcerpts, readProposal, readRun, updateRun } from "@/lib/runs";
import { getProject } from "@/lib/vault";

export const dynamic = "force-dynamic";

const Slug = z.string().min(1).max(64);

/**
 * Read a run's proposal, with its grounding report.
 *
 * Grounding is computed here rather than in the browser so the brief never has to be
 * shipped alongside the proposal purely to re-derive it — and so there is exactly one
 * implementation of the check.
 */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const runParam = url.searchParams.get("runId");
  const slugParam = url.searchParams.get("slug");

  let runId = runParam;
  if (!runId) {
    // No run named: offer the newest ready proposal for this project, which is how a
    // tab that was closed mid-run finds its result again.
    const slug = Slug.parse(slugParam);
    const latest = (await listRuns(slug)).find((r) => r.status === "ready" && !r.appliedAt);
    if (!latest) return Response.json({ run: null });
    runId = latest.runId;
  }

  assertRunId(runId);
  const run = await readRun(runId);
  if (!run) throw new VaultError("not_found", `No run ${runId}`);

  const result = await readProposal(runId);
  if (!result.ok || !result.proposal) {
    return Response.json({ run, ok: false, error: result.error, raw: result.raw });
  }

  const project = await getProject(run.slug);
  /*
   * The excerpts this run was given, read back rather than re-retrieved.
   *
   * Verification has to compare against the bytes the model actually saw. Searching the
   * index again here would rank against the current repo state and mark a citation false
   * the moment the developer saves a file, which is the opposite of an audit trail.
   */
  const excerpts = await readExcerpts(runId);
  return Response.json({
    run,
    ok: true,
    proposal: result.proposal,
    excerpts,
    grounding: verifyGrounding(project.brief, result.proposal, excerpts),
    warnings: proposalWarnings(project.brief, result.proposal, excerpts),
  });
});

const ApplyBody = z.object({
  runId: z.string().min(1).max(64),
  selection: SelectionSchema,
});

/**
 * Apply the accepted blocks.
 *
 * Re-reads and re-validates the proposal from disk rather than trusting a body sent by
 * the client: the browser must be able to say *which* blocks were accepted, never *what
 * they contain*. Otherwise the review would be advisory and anything could be written.
 */
export const POST = route(
  async (req) => {
    const input = await readJson(req, ApplyBody);
    assertRunId(input.runId);

    const run = await readRun(input.runId);
    if (!run) throw new VaultError("not_found", `No run ${input.runId}`);
    if (run.appliedAt) {
      throw new VaultError("conflict", "This proposal has already been applied.");
    }

    const result = await readProposal(input.runId);
    if (!result.ok || !result.proposal) {
      throw new VaultError("invalid_document", result.error ?? "The proposal is not usable");
    }

    const applied = await applyProposal(result.proposal, input.selection);
    await updateRun(input.runId, { appliedAt: new Date().toISOString() });

    return Response.json(applied);
  },
  { mutating: true },
);

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Proposal } from "@/lib/ai/types";

/**
 * The merge at its call site.
 *
 * `tests/ai-merge.test.ts` proves `mergeCardBody` is right; this proves `applyProposal`
 * actually calls it, carries the baseline, and takes the snapshot first. A guard that is
 * correct and not installed has passed a whole suite in this codebase before.
 *
 * A throwaway vault with no `.git`, so the commit step reports itself skipped and cannot
 * fail the apply — which is also the rule.
 */

let dir: string;
let vault: typeof import("@/lib/vault");
let apply: typeof import("@/lib/ai/apply");

const SLUG = "apply-test";

const PROJECT = `---
name: Apply Test
slug: ${SLUG}
stage: shaping
health: green
archetype: client
columns: [Intake, Shaping, Done]
created: 2026-08-01
updated: 2026-08-01
---

A brief.
`;

const CARD = `---
id: 1
title: Existing
column: Intake
phase: 1
priority: P2
size: M
confidence: 0.5
blocked: false
order: 100
created: 2026-08-01
updated: 2026-08-01
---

Thin description.

## Acceptance criteria

- [ ] A
- [x] B

Notes after the list.
`;

const proposal: Proposal = {
  runId: "run_20260825_1200",
  job: "enhance-card",
  slug: SLUG,
  summary: "Expanded the card.",
  phases: [],
  cards: [
    {
      op: "update",
      id: 1,
      title: "Existing card expanded",
      priority: "P1",
      size: "M",
      confidence: 0.6,
      body: "New description.",
      // "a" matches the user's "A" by normalised text; "C" is new; "B" is omitted on purpose.
      acceptance: ["a", "C"],
      groundedIn: null,
    },
  ],
  risks: [],
  assumptions: [],
  questions: [],
};

const cardPath = () => path.join(dir, SLUG, "cards", "0001-existing.md");

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-apply-"));
  process.env.GROUNDWORK_VAULT = dir;
  vi.resetModules();
  await fsp.mkdir(path.join(dir, SLUG, "cards"), { recursive: true });
  await fsp.writeFile(path.join(dir, SLUG, "project.md"), PROJECT, "utf8");
  await fsp.writeFile(cardPath(), CARD, "utf8");
  vault = await import("@/lib/vault");
  apply = await import("@/lib/ai/apply");
});

afterEach(async () => {
  delete process.env.GROUNDWORK_VAULT;
  await fsp.rm(dir, { recursive: true, force: true });
});

const selection = (baselines: Record<string, number>) => ({
  cards: [0],
  phases: [],
  risks: [],
  assumptions: [],
  questions: [],
  baselines,
});

describe("applyProposal — an update merges over the user's criteria", () => {
  it("keeps every hand-written criterion, its tick and its order, and only adds", async () => {
    const before = await vault.getCard(SLUG, 1);
    const result = await apply.applyProposal(proposal, selection({ "1": before.mtimeMs }));

    const raw = await fsp.readFile(cardPath(), "utf8");
    expect(raw).toContain("- [ ] A\n- [x] B\n- [ ] C\n");
    expect(raw).toContain("New description.");
    expect(raw).not.toContain("Thin description.");
    expect(raw).toContain("Notes after the list.");
    expect(raw.match(/## Acceptance criteria/g)).toHaveLength(1);
    // The user's spelling won over the model's lower-case "a".
    expect(raw).not.toContain("- [ ] a\n");
    // Metadata landed too, threaded on the mtime the body write returned.
    expect(raw).toContain("title: Existing card expanded");
    expect(raw).toContain("priority: P1");

    expect(result.applied.cardsUpdated).toBe(1);
    expect(result.commit.ok).toBe(false); // no .git here, and that must not fail the apply
  });

  it("snapshots the original before writing", async () => {
    const before = await vault.getCard(SLUG, 1);
    const result = await apply.applyProposal(proposal, selection({ "1": before.mtimeMs }));

    const snap = path.join(dir, SLUG, ".snapshots", result.snapshotId, "cards", "0001-existing.md");
    expect(await fsp.readFile(snap, "utf8")).toBe(CARD);
  });

  it("refuses an update whose review carried no baseline, and writes nothing", async () => {
    await expect(apply.applyProposal(proposal, selection({}))).rejects.toMatchObject({
      code: "invalid_document",
    });
    expect(await fsp.readFile(cardPath(), "utf8")).toBe(CARD);
  });

  it("refuses an update when the card changed since the review", async () => {
    const before = await vault.getCard(SLUG, 1);
    await expect(
      apply.applyProposal(proposal, selection({ "1": before.mtimeMs - 1000 })),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await fsp.readFile(cardPath(), "utf8")).toBe(CARD);
  });
});

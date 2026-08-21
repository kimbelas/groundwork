import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Run storage and the concurrency lock.
 *
 * The lock is the only thing stopping two runs from working the same project at once,
 * and a lock that can wedge permanently is worse than none — so both the mutual
 * exclusion and the staleness escape hatch are covered.
 */

let dir: string;
let runs: typeof import("@/lib/runs");

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-runs-"));
  process.env.GROUNDWORK_RUNS = path.join(dir, "runs");
  vi.resetModules();
  runs = await import("@/lib/runs");
});

afterEach(async () => {
  delete process.env.GROUNDWORK_RUNS;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("assertRunId", () => {
  it("accepts the generated shape", () => {
    expect(runs.assertRunId("run_20260819_0614")).toBe("run_20260819_0614");
    expect(runs.assertRunId("run_20260819_0614_2")).toBe("run_20260819_0614_2");
  });

  it("rejects traversal and anything off-format", () => {
    for (const bad of ["../escape", "run_x", "", "run_20260819", "run_20260819_0614/../x"]) {
      expect(() => runs.assertRunId(bad), bad).toThrow();
    }
  });
});

describe("makeRunId", () => {
  it("is derived from the clock", () => {
    const id = runs.makeRunId(new Date(2026, 7, 19, 6, 14));
    expect(id).toBe("run_20260819_0614");
  });

  it("appends a counter rather than colliding within the same minute", async () => {
    const at = new Date(2026, 7, 19, 6, 14);
    const first = runs.makeRunId(at);
    await runs.createRun({
      runId: first,
      slug: "x",
      job: "synthesize",
      status: "running",
      startedAt: at.toISOString(),
      finishedAt: null,
    });
    expect(runs.makeRunId(at)).toBe("run_20260819_0614_2");
  });
});

describe("run records", () => {
  const base = {
    runId: "run_20260819_0614",
    slug: "portal",
    job: "synthesize" as const,
    status: "running" as const,
    startedAt: "2026-08-19T06:14:00.000Z",
    finishedAt: null,
  };

  it("round-trips", async () => {
    await runs.createRun(base);
    expect(await runs.readRun(base.runId)).toEqual(base);
  });

  it("patches without losing untouched fields", async () => {
    await runs.createRun(base);
    await runs.updateRun(base.runId, { status: "ready", finishedAt: "later" });

    const after = await runs.readRun(base.runId);
    expect(after?.status).toBe("ready");
    expect(after?.slug).toBe("portal");
  });

  it("returns null for a run that does not exist", async () => {
    expect(await runs.readRun("run_20990101_0000")).toBeNull();
  });

  it("keeps what the repository contributed, including why it contributed nothing", async () => {
    /*
     * Recorded rather than recomputed: an index rebuilt tomorrow would answer "was this
     * plan grounded in the code" differently, and the honest answer is the one from the
     * time the run happened. The reason travels with it because "no-index" alone does not
     * tell the reader what to do about it.
     */
    await runs.createRun({
      ...base,
      repoContext: {
        status: "stale-index",
        excerpts: 0,
        semantic: false,
        reason: "The index was built from a different repository.",
      },
    });

    const after = await runs.readRun(base.runId);
    expect(after?.repoContext?.status).toBe("stale-index");
    expect(after?.repoContext?.reason).toMatch(/different repository/);

    // A patch elsewhere must not drop it - the record is read by the review UI.
    await runs.updateRun(base.runId, { status: "ready" });
    expect((await runs.readRun(base.runId))?.repoContext?.status).toBe("stale-index");
  });

  it("still reads a record written before repo grounding existed", async () => {
    // The field is optional for this reason: an old run must not become unreadable, which
    // would hide a proposal someone is still waiting on.
    await runs.createRun(base);
    expect(await runs.readRun(base.runId)).toEqual(base);
  });

  it("lists newest first and filters by project", async () => {
    await runs.createRun(base);
    await runs.createRun({ ...base, runId: "run_20260819_0700", slug: "other" });

    expect((await runs.listRuns()).map((r) => r.runId)).toEqual([
      "run_20260819_0700",
      "run_20260819_0614",
    ]);
    expect((await runs.listRuns("portal")).map((r) => r.runId)).toEqual(["run_20260819_0614"]);
  });
});

describe("readProposal", () => {
  const runId = "run_20260819_0614";
  const valid = {
    runId,
    job: "synthesize",
    slug: "portal",
    summary: "A summary",
    cards: [],
    questions: [],
  };

  it("validates and returns a good proposal", async () => {
    await runs.writeProposal(runId, valid);
    const result = await runs.readProposal(runId);
    expect(result.ok).toBe(true);
    expect(result.proposal?.summary).toBe("A summary");
  });

  it("reports a missing proposal instead of throwing", async () => {
    const result = await runs.readProposal(runId);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no proposal/i);
  });

  it("surfaces the raw text when the JSON is malformed", async () => {
    const { dir: runDirPath, proposal } = runs.runPaths(runId);
    await fsp.mkdir(runDirPath, { recursive: true });
    await fsp.writeFile(proposal, "{ not json", "utf8");

    const result = await runs.readProposal(runId);
    expect(result.ok).toBe(false);
    expect(result.raw).toBe("{ not json");
  });

  it("surfaces the raw text when the shape is wrong, never a partial parse", async () => {
    await runs.writeProposal(runId, { runId, job: "synthesize", slug: "portal" });
    const result = await runs.readProposal(runId);

    expect(result.ok).toBe(false);
    expect(result.proposal).toBeUndefined();
    expect(result.raw).toContain("synthesize");
    expect(result.error).toMatch(/summary/);
  });
});

describe("lock", () => {
  it("grants to the first caller only", () => {
    expect(runs.acquireLock("run_20260819_0614")).toBe(true);
    expect(runs.acquireLock("run_20260819_0615")).toBe(false);
  });

  it("reports who holds it", () => {
    runs.acquireLock("run_20260819_0614");
    expect(runs.readLock()?.runId).toBe("run_20260819_0614");
  });

  it("can be released and re-taken", () => {
    runs.acquireLock("run_20260819_0614");
    runs.releaseLock();
    expect(runs.acquireLock("run_20260819_0615")).toBe(true);
  });

  it("releasing when unheld is not an error", () => {
    expect(() => runs.releaseLock()).not.toThrow();
  });

  it("breaks a stale lock so a crash cannot wedge the feature", async () => {
    runs.acquireLock("run_20260819_0614");

    const old = new Date(Date.now() - 45 * 60_000).toISOString();
    await fsp.writeFile(
      runs.lockFile(),
      JSON.stringify({ runId: "run_20260819_0614", startedAt: old }),
      "utf8",
    );

    expect(runs.acquireLock("run_20260819_0700")).toBe(true);
    expect(runs.readLock()?.runId).toBe("run_20260819_0700");
  });

  it("does not break a lock that is merely recent", () => {
    runs.acquireLock("run_20260819_0614");
    expect(runs.acquireLock("run_20260819_0615")).toBe(false);
  });
});

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finding a run that is still working, and reading one run's record by id.
 *
 * Both exist for the same bug. The run deliberately outlives the response that started it,
 * so a tab switch aborted the stream and left synthesis going with nothing on screen saying
 * so — and `pendingRunFor` could not help, because it is `ready`-only by contract. The tests
 * that matter here are the ones asserting the two lookups stay *separate*: a `running`
 * record must never surface as a proposal to review.
 */

let dir: string;
let runs: typeof import("@/lib/runs");
let route: typeof import("@/app/api/ai/runs/route");

const RUNNING = {
  status: "running" as const,
  startedAt: "2026-08-29T15:07:00.000Z",
  finishedAt: null,
};

function get(params: Record<string, string>): Request {
  const q = new URLSearchParams(params).toString();
  return new Request(`http://127.0.0.1:4848/api/ai/runs?${q}`, {
    headers: { host: "127.0.0.1:4848" },
  });
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-runs-active-"));
  process.env.GROUNDWORK_RUNS = path.join(dir, "runs");
  vi.resetModules();
  runs = await import("@/lib/runs");
  route = await import("@/app/api/ai/runs/route");
});

afterEach(async () => {
  delete process.env.GROUNDWORK_RUNS;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("activeRunFor", () => {
  it("finds a run that is still working", async () => {
    await runs.createRun({ ...RUNNING, runId: "run_20260829_1507", slug: "alpha", job: "synthesize" });

    const found = await runs.activeRunFor("alpha", ["synthesize", "critique"]);
    expect(found?.runId).toBe("run_20260829_1507");
  });

  it("does not offer a running run as a proposal to review", async () => {
    /*
     * The separation this whole pair exists to keep. Folding `running` into `pendingRunFor`
     * would open a review against a `proposal.json` that has not been written yet — the same
     * class of bug as the job-agnostic lookups that rule replaced.
     */
    await runs.createRun({ ...RUNNING, runId: "run_20260829_1507", slug: "alpha", job: "synthesize" });

    expect(await runs.pendingRunFor("alpha", { job: ["synthesize", "critique"] })).toBeNull();
    expect(await runs.activeRunFor("alpha", ["synthesize"])).not.toBeNull();
  });

  it("stops reporting a run once it is ready, so the panel can hand over", async () => {
    await runs.createRun({ ...RUNNING, runId: "run_20260829_1507", slug: "alpha", job: "synthesize" });
    await runs.updateRun("run_20260829_1507", {
      status: "ready",
      finishedAt: "2026-08-29T15:16:55.000Z",
    });

    expect(await runs.activeRunFor("alpha", ["synthesize"])).toBeNull();
    expect(await runs.pendingRunFor("alpha", { job: ["synthesize"] })).not.toBeNull();
  });

  it("ignores a running job of a kind the caller did not ask for", async () => {
    // A card enhancement belongs to the card. It used to surface on the brief page.
    await runs.createRun({
      ...RUNNING,
      runId: "run_20260829_1507",
      slug: "alpha",
      job: "enhance-card",
      cardId: 3,
    });

    expect(await runs.activeRunFor("alpha", ["synthesize", "critique"])).toBeNull();
  });

  it("ignores a run belonging to another project", async () => {
    await runs.createRun({ ...RUNNING, runId: "run_20260829_1507", slug: "beta", job: "synthesize" });

    expect(await runs.activeRunFor("alpha", ["synthesize"])).toBeNull();
  });

  it("returns null when nothing is running", async () => {
    expect(await runs.activeRunFor("alpha", ["synthesize"])).toBeNull();
  });
});

describe("GET /api/ai/runs?runId", () => {
  it("returns the record so a page can poll it", async () => {
    await runs.createRun({ ...RUNNING, runId: "run_20260829_1507", slug: "alpha", job: "synthesize" });

    const res = await route.GET(get({ slug: "alpha", runId: "run_20260829_1507" }), undefined);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { run: { status: string } | null };
    expect(body.run?.status).toBe("running");
  });

  it("reads as absent when the run belongs to a different project", async () => {
    /*
     * Run ids are a timestamp, so they are guessable. Without the slug check one project's
     * page could read another's run. Null rather than a refusal, so the caller's handling is
     * the same as for a run that was cleaned up.
     */
    await runs.createRun({ ...RUNNING, runId: "run_20260829_1507", slug: "beta", job: "synthesize" });

    const res = await route.GET(get({ slug: "alpha", runId: "run_20260829_1507" }), undefined);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { run: unknown }).run).toBeNull();
  });

  it("reads as absent for a run that does not exist", async () => {
    const res = await route.GET(get({ slug: "alpha", runId: "run_20260101_0000" }), undefined);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { run: unknown }).run).toBeNull();
  });

  it("refuses a request that asks for neither a cardId nor a runId", async () => {
    const res = await route.GET(get({ slug: "alpha" }), undefined);
    expect(res.status).toBe(422);
  });

  it("refuses a request that asks for both", async () => {
    const res = await route.GET(
      get({ slug: "alpha", runId: "run_20260829_1507", cardId: "3" }),
      undefined,
    );
    expect(res.status).toBe(422);
  });

  it("still lists a card's runs, which is what the drawer uses", async () => {
    await runs.createRun({
      ...RUNNING,
      runId: "run_20260829_1507",
      slug: "alpha",
      job: "enhance-card",
      cardId: 3,
    });

    const res = await route.GET(get({ slug: "alpha", cardId: "3" }), undefined);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: { runId: string }[] };
    expect(body.runs.map((r) => r.runId)).toEqual(["run_20260829_1507"]);
  });
});

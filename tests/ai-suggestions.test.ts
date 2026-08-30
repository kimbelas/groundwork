import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { oneSentence, SuggestionsSchema } from "@/lib/ai/types";

/**
 * Suggested answers to open questions.
 *
 * The stake here is different from a proposal's. Nothing is written to the vault — the user
 * clicks an option and it fills a box they can still edit — but the sentence they end up
 * storing becomes a *confirmed fact* handed to every later run. So the grounding distinction
 * carries more weight than usual: an option that looks quoted when it was inferred makes a
 * guess look like a decision the project already made.
 */

let dir: string;
let runs: typeof import("@/lib/runs");
let route: typeof import("@/app/api/ai/suggestions/route");

const RUN_ID = "run_20260829_1507";

function valid(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    job: "suggest-answers",
    slug: "alpha",
    summary: "Two questions, one of which blocks the schema.",
    questions: [
      {
        questionId: "q1",
        options: [
          { text: "Pay at intake only for v1.", because: "Smallest change.", groundedIn: "pay-on-claim is v2" },
          { text: "Support both from the start.", because: "Avoids a migration.", groundedIn: null },
          { text: "Defer and record it as out of scope.", because: "Keeps the plan honest.", groundedIn: null },
        ],
      },
    ],
    ...overrides,
  };
}

function get(params: Record<string, string>): Request {
  return new Request(`http://127.0.0.1:4848/api/ai/suggestions?${new URLSearchParams(params)}`, {
    headers: { host: "127.0.0.1:4848" },
  });
}

async function writeOutput(runId: string, body: unknown): Promise<void> {
  const { proposal } = runs.runPaths(runId);
  await fsp.mkdir(path.dirname(proposal), { recursive: true });
  await fsp.writeFile(proposal, JSON.stringify(body), "utf8");
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-suggest-"));
  process.env.GROUNDWORK_RUNS = path.join(dir, "runs");
  vi.resetModules();
  runs = await import("@/lib/runs");
  route = await import("@/app/api/ai/suggestions/route");
});

afterEach(async () => {
  delete process.env.GROUNDWORK_RUNS;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("SuggestionsSchema", () => {
  it("accepts three grounded options", () => {
    const parsed = SuggestionsSchema.safeParse(valid());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.questions[0]!.options).toHaveLength(3);
  });

  it("accepts a single honest option rather than discarding the run", () => {
    /*
     * Three is what the prompt asks for and one is what the schema tolerates. A hard minimum
     * of three would throw away a whole run because the model could only think of two honest
     * answers to one question out of ten — the exact failure already seen when one absent
     * `groundedIn` invalidated a proposal of sixteen cards.
     */
    const one = valid({
      questions: [{ questionId: "q1", options: [{ text: "Keep it as is.", groundedIn: null }] }],
    });
    expect(SuggestionsSchema.safeParse(one).success).toBe(true);
  });

  it("refuses a question with no options at all", () => {
    const none = valid({ questions: [{ questionId: "q1", options: [] }] });
    expect(SuggestionsSchema.safeParse(none).success).toBe(false);
  });

  it("refuses more than three, so the list cannot become a wall", () => {
    const four = valid({
      questions: [
        {
          questionId: "q1",
          options: Array.from({ length: 4 }, (_, i) => ({ text: `Option ${i}`, groundedIn: null })),
        },
      ],
    });
    expect(SuggestionsSchema.safeParse(four).success).toBe(false);
  });

  it("requires groundedIn to be present, even as null", () => {
    // The forced choice is the anti-invention mechanism: filler has nothing to quote.
    const missing = valid({
      questions: [{ questionId: "q1", options: [{ text: "An answer." }] }],
    });
    expect(SuggestionsSchema.safeParse(missing).success).toBe(false);
  });

  it("defaults because to empty rather than failing on it", () => {
    const parsed = SuggestionsSchema.safeParse(
      valid({ questions: [{ questionId: "q1", options: [{ text: "An answer.", groundedIn: null }] }] }),
    );
    expect(parsed.success && parsed.data.questions[0]!.options[0]!.because).toBe("");
  });
});

describe("GET /api/ai/suggestions", () => {
  it("returns the options for a finished run", async () => {
    await runs.createRun({
      runId: RUN_ID,
      slug: "alpha",
      job: "suggest-answers",
      status: "ready",
      startedAt: "2026-08-29T15:07:00.000Z",
      finishedAt: "2026-08-29T15:09:00.000Z",
    });
    await writeOutput(RUN_ID, valid());

    const res = await route.GET(get({ slug: "alpha", runId: RUN_ID }), undefined);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; suggestions?: { questions: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.suggestions?.questions).toHaveLength(1);
  });

  it("reports malformed output with its raw text instead of dropping it", async () => {
    await runs.createRun({
      runId: RUN_ID,
      slug: "alpha",
      job: "suggest-answers",
      status: "ready",
      startedAt: "2026-08-29T15:07:00.000Z",
      finishedAt: "2026-08-29T15:09:00.000Z",
    });
    await writeOutput(RUN_ID, { job: "suggest-answers", questions: "not an array" });

    const res = await route.GET(get({ slug: "alpha", runId: RUN_ID }), undefined);
    const body = (await res.json()) as { ok: boolean; error?: string; raw?: string };

    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(body.raw).toContain("not an array");
  });

  it("refuses a run belonging to another project", async () => {
    // Run ids are timestamps, so they are guessable.
    await runs.createRun({
      runId: RUN_ID,
      slug: "beta",
      job: "suggest-answers",
      status: "ready",
      startedAt: "2026-08-29T15:07:00.000Z",
      finishedAt: null,
    });

    const res = await route.GET(get({ slug: "alpha", runId: RUN_ID }), undefined);
    expect(res.status).toBe(404);
  });

  it("refuses a run of a different job kind rather than mis-parsing it", async () => {
    /*
     * A proposal read with the suggestions schema fails in a confusing way — a list of zod
     * complaints about a document that is perfectly valid, just not this shape. The job kind
     * comes off the record, not the query string.
     */
    await runs.createRun({
      runId: RUN_ID,
      slug: "alpha",
      job: "synthesize",
      status: "ready",
      startedAt: "2026-08-29T15:07:00.000Z",
      finishedAt: null,
    });

    const res = await route.GET(get({ slug: "alpha", runId: RUN_ID }), undefined);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/synthesize/);
  });

  it("refuses a malformed run id rather than resolving a path from it", async () => {
    const res = await route.GET(get({ slug: "alpha", runId: "../../etc" }), undefined);
    expect(res.status).toBe(400);
  });
});

describe("oneSentence", () => {
  it("keeps a short sentence exactly as written", () => {
    expect(oneSentence("Pay at intake only for v1.", 200)).toBe("Pay at intake only for v1.");
  });

  it("takes the first sentence and drops the rest", () => {
    expect(oneSentence("Do this. Then also do that. And a third thing.", 200)).toBe("Do this.");
  });

  it("ends on a question mark or an exclamation too", () => {
    expect(oneSentence("Is it worth it? Probably not.", 200)).toBe("Is it worth it?");
  });

  it("does not split on a decimal or an abbreviation", () => {
    // A full stop only ends a sentence when a space or the end follows it.
    expect(oneSentence("Budget is 1.5 million pesos.", 200)).toBe("Budget is 1.5 million pesos.");
  });

  it("truncates a long single sentence on a word boundary", () => {
    const long = `${"word ".repeat(60)}end.`;
    const out = oneSentence(long, 40);

    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…")).toBe(true);
    // The ellipsis lands after a whole word, never mid-word.
    expect(out.slice(0, -1).trimEnd().endsWith("word")).toBe(true);
  });

  it("still truncates when there is no space to cut on", () => {
    const out = oneSentence("a".repeat(300), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("length never invalidates a document", () => {
  it("shortens an over-long option instead of rejecting the run", () => {
    /*
     * The regression this pins, and it is one that actually shipped for a few minutes.
     *
     * The caps went in as `.max()`, and output written moments earlier under the old limits
     * was refused wholesale - a wall of zod complaints where the answers had been. Grounding
     * has to fail loudly because it is a correctness problem; length does not, because it is
     * a presentation one, and the honest response is to show less of it.
     */
    const verbose = valid({
      summary: "S".repeat(1200),
      questions: [
        {
          questionId: "q1",
          options: [
            { text: `${"long ".repeat(200)}end.`, because: "B".repeat(900), groundedIn: null },
          ],
        },
      ],
    });

    const parsed = SuggestionsSchema.safeParse(verbose);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.summary.length).toBeLessThanOrEqual(240);
    expect(parsed.data.questions[0]!.options[0]!.text.length).toBeLessThanOrEqual(200);
    expect(parsed.data.questions[0]!.options[0]!.because.length).toBeLessThanOrEqual(140);
  });

  it("still refuses something absurd, which is a broken document rather than a long one", () => {
    const absurd = valid({
      questions: [
        { questionId: "q1", options: [{ text: "x".repeat(5000), groundedIn: null }] },
      ],
    });
    expect(SuggestionsSchema.safeParse(absurd).success).toBe(false);
  });
});

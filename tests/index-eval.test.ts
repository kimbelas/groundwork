import { describe, expect, it } from "vitest";

import { firstRelevantRank, formatReport, scoreEval } from "@/lib/index/eval";
import { keywordRanking } from "@/lib/index/keyword";

import { CASES, CHUNKS, DOCS, NL, PARAPHRASES } from "./fixtures/retrieval-corpus";

/**
 * The retrieval regression gate.
 *
 * ## Why a gate and not a benchmark
 *
 * Retrieval quality has no compile error. Change the chunk size, the stopword list, the
 * fusion constant or the model, and nothing breaks — results just get quietly worse, and
 * the symptom appears much later as planning that cites the wrong file. This is the only
 * thing standing between a tuning change and that outcome.
 *
 * ## Why keyword-only
 *
 * The floors below are enforced against the KEYWORD ranker alone, deliberately.
 *
 * Gating on the semantic half would mean the unit suite downloading a few hundred megabytes
 * of model weights, and a suite that needs a network is a suite that fails for reasons
 * unrelated to the code. Worse, the honest way to handle a missing model in a gate is to
 * skip — and a skipped quality gate is one nobody notices has stopped running.
 *
 * So the fast, deterministic, always-runnable half is gated here, and the full hybrid
 * numbers are produced by `pnpm eval:retrieval`, which loads the model and prints both.
 * Keyword-only is also the floor a user gets on a fresh machine, so it is worth protecting
 * on its own account.
 */

/**
 * The floors.
 *
 * Set just under what the current implementation achieves, so an improvement never has to
 * edit them and a regression always fails. Raising them is a deliberate act; lowering one
 * to make a build pass is the thing this file exists to make visible.
 */
const RECALL_FLOOR = 0.9;
const MRR_FLOOR = 0.8;

describe("the eval harness itself", () => {
  it("finds the rank of the first relevant result, 1-based", () => {
    expect(firstRelevantRank(["a", "b", "c"], ["c"])).toBe(3);
    expect(firstRelevantRank(["a"], ["a"])).toBe(1);
  });

  it("returns null when nothing relevant came back", () => {
    expect(firstRelevantRank(["a", "b"], ["z"])).toBeNull();
  });

  it("counts a hit when any one relevant id appears", () => {
    const report = scoreEval([{ query: "q", relevant: ["x", "y"] }], () => ["y"], 5);
    expect(report.recall).toBe(1);
  });

  it("truncates at k, so a hit below the cutoff is a miss", () => {
    const report = scoreEval([{ query: "q", relevant: ["third"] }], () => ["a", "b", "third"], 2);
    expect(report.recall).toBe(0);
    expect(report.misses).toEqual(["q"]);
  });

  it("scores MRR by position, catching a regression recall cannot see", () => {
    /*
     * The metric that notices a change pushing every answer from rank one to rank five.
     * Recall stays flat and the results get materially worse to read.
     */
    const atOne = scoreEval([{ query: "q", relevant: ["a"] }], () => ["a", "b"], 5);
    const atTwo = scoreEval([{ query: "q", relevant: ["a"] }], () => ["b", "a"], 5);

    expect(atOne.recall).toBe(atTwo.recall);
    expect(atOne.mrr).toBeGreaterThan(atTwo.mrr);
  });

  it("scores an empty corpus as zero rather than NaN", () => {
    // A gate comparing NaN to a floor is always false, so an empty corpus would silently
    // pass every threshold it was given.
    const report = scoreEval([], () => [], 5);
    expect(report.recall).toBe(0);
    expect(report.mrr).toBe(0);
  });

  it("formats a report that names what it missed", () => {
    const report = scoreEval([{ query: "unfindable", relevant: ["z"] }], () => ["a"], 5);
    const text = formatReport("keyword", report);
    expect(text).toContain("recall@5");
    expect(text).toContain("missed: unfindable");
  });
});

describe("keyword retrieval meets its floor", () => {
  const report = scoreEval(CASES, (q) => keywordRanking(DOCS, q), 5);

  it(`recalls at least ${RECALL_FLOOR * 100}% of answers in the top 5`, () => {
    // Lowering this to make a build pass is the failure mode this gate exists to expose.
    expect(report.recall, formatReport("keyword", report)).toBeGreaterThanOrEqual(RECALL_FLOOR);
  });

  it(`ranks them well enough for MRR to stay above ${MRR_FLOOR}`, () => {
    expect(report.mrr, formatReport("keyword", report)).toBeGreaterThanOrEqual(MRR_FLOOR);
  });

  it("finds an exact identifier, which is what keyword search is for", () => {
    // The case semantic search is worst at: asked for a symbol, it returns prose about the
    // concept. This is why the keyword ranker is a peer and not a fallback.
    for (const query of ["expectedMtimeMs", "ORDER_STEP", "THEME_COOKIE"]) {
      const ranked = keywordRanking(DOCS, query);
      expect(ranked.length, query).toBeGreaterThan(0);
    }
  });

  it("returns the same ranking every time", () => {
    // A derived index that reshuffles makes every regression unprovable.
    const once = keywordRanking(DOCS, "snapshot before apply");
    const twice = keywordRanking(DOCS, "snapshot before apply");
    expect(once).toEqual(twice);
  });

  it("has a corpus large enough for the numbers to mean something", () => {
    // A floor over three cases is noise. This guards the gate against being quietly
    // hollowed out by someone trimming the corpus.
    expect(CASES.length).toBeGreaterThanOrEqual(10);
    expect(CHUNKS.length).toBeGreaterThanOrEqual(8);
  });

  it("does worse on a paraphrased question than on an exact term", () => {
    /*
     * Why the semantic half exists, asserted rather than assumed.
     *
     * A relative comparison on purpose. An absolute ceiling - "keyword recall on paraphrases
     * must stay below 40%" - would fail the day someone improved the tokenizer, which is the
     * opposite of what a gate should do. The relationship is the durable claim: matching
     * words cannot answer a question that does not use them, so if this ever stops being
     * true, either the corpus stopped being representative or keyword search has quietly
     * become semantic, and both deserve a look.
     */
    const exact = scoreEval(CASES, (q) => keywordRanking(DOCS, q), 5);
    const paraphrased = scoreEval(PARAPHRASES, (q) => keywordRanking(DOCS, q), 5);

    expect(
      paraphrased.recall,
      `${formatReport("exact", exact)}${NL}${formatReport("paraphrase", paraphrased)}`,
    ).toBeLessThan(exact.recall);
  });

  it("has a paraphrase set worth measuring", () => {
    expect(PARAPHRASES.length).toBeGreaterThanOrEqual(5);
    for (const c of PARAPHRASES) expect(c.relevant.length, c.query).toBeGreaterThan(0);
  });

  it("has a relevance set for every case", () => {
    // A case whose `relevant` list is empty can never be hit, so it would silently drag
    // recall down and look like a retrieval problem.
    for (const c of CASES) {
      expect(c.relevant.length, c.query).toBeGreaterThan(0);
    }
  });
});

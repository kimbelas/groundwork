import { describe, expect, it } from "vitest";

import { RRF_K, rrfFuse } from "@/lib/index/fusion";
import { keywordRanking, queryTerms, tokenize } from "@/lib/index/keyword";
import { dot, isNormalized, normalize, rankBySimilarity } from "@/lib/index/similarity";

/**
 * The ranking rules, all pure and all testable without a model.
 *
 * That separation is the point: retrieval quality is decided here, and if these needed the
 * embedding runtime to run, they would be run by nobody.
 */

describe("rrfFuse", () => {
  it("rewards an item both rankers found over one that only a single ranker topped", () => {
    /*
     * The whole reason for fusion: `b` is second on both lists and beats two items that
     * each came first on one list and were missing from the other. Appearing in both
     * rankings is the evidence; being someone's favourite is not.
     *
     * Note what this does NOT say. If `a` were first on one list and LAST on the other, it
     * would beat `b` - because 1/60 + 1/62 is greater than 2/61. The reciprocal is convex,
     * so being seen at all carries most of the weight and two mid ranks do not automatically
     * outscore a high one plus a low one. Fusion rewards presence in several rankings, which
     * is a weaker and more honest claim than "agreement wins".
     */
    const fused = rrfFuse(
      [
        ["a", "b"],
        ["c", "b"],
      ],
      3,
    );
    expect(fused[0]).toBe("b");
  });

  it("does not claim two mid ranks beat a high rank plus a low one", () => {
    // The arithmetic above, asserted directly, so the comment cannot rot into a wish.
    expect(1 / (RRF_K + 0) + 1 / (RRF_K + 2)).toBeGreaterThan(2 * (1 / (RRF_K + 1)));
  });

  it("scores by rank position, not by any score the rankers held", () => {
    // Neither list carries a number. A cosine similarity and a term-hit count share no
    // scale, and forcing them onto one is a fudge factor that needs retuning forever.
    expect(rrfFuse([["x"], ["x"]], 1)).toEqual(["x"]);
  });

  it("keeps an item found by only one ranker", () => {
    const fused = rrfFuse([["only-semantic"], ["only-keyword"]], 2);
    expect([...fused].sort()).toEqual(["only-keyword", "only-semantic"]);
  });

  it("respects the limit", () => {
    expect(rrfFuse([["a", "b", "c", "d"]], 2).length).toBe(2);
  });

  it("handles a single ranking, which is the keyword-only path", () => {
    expect(rrfFuse([["a", "b"]], 5)).toEqual(["a", "b"]);
  });

  it("returns nothing for no rankings and for empty ones", () => {
    expect(rrfFuse([], 5)).toEqual([]);
    expect(rrfFuse([[], []], 5)).toEqual([]);
  });

  it("does not depend on the order the rankings are passed in", () => {
    /*
     * The determinism property. `Array.prototype.sort` is stable, so tied items would
     * otherwise be ordered by Map insertion — which follows whichever ranker ran first.
     * That made the result depend on argument order and turned "did retrieval change?"
     * into a question nobody could answer.
     */
    const a = ["p", "q", "r"];
    const b = ["r", "q", "p"];
    expect(rrfFuse([a, b], 3)).toEqual(rrfFuse([b, a], 3));
  });

  it("breaks ties by id, so the same input always gives the same output", () => {
    expect(rrfFuse([["zebra"], ["apple"]], 2)).toEqual(["apple", "zebra"]);
  });

  it("dampens top ranks, so being in two lists beats topping one", () => {
    // At the conventional 60, rank 1 and rank 2 are close together — which is what lets a
    // second place in both lists outscore a first place in only one.
    expect(2 * (1 / (RRF_K + 1))).toBeGreaterThan(1 / (RRF_K + 0));
  });
});

describe("tokenize", () => {
  it("splits camelCase while keeping the whole identifier", () => {
    // A query for `mtime` must find `expectedMtimeMs`, and a query for the full name must
    // still score higher — which works because the whole name is one term and each part
    // is another, so the exact match hits more terms.
    const terms = tokenize("expectedMtimeMs");
    expect(terms).toContain("expectedmtimems");
    expect(terms).toContain("mtime");
    expect(terms).toContain("expected");
  });

  it("splits snake_case and kebab-case", () => {
    expect(tokenize("max_line_chars")).toContain("line");
    expect(tokenize("repo-path")).toContain("repo");
  });

  it("splits a run of capitals before a word", () => {
    // `HTTPServer` is HTTP + Server, not HTTPSe + rver.
    const terms = tokenize("HTTPServer");
    expect(terms).toContain("http");
    expect(terms).toContain("server");
  });

  it("keeps digits, which identifiers use", () => {
    expect(tokenize("upgrade to v2")).toContain("v2");
  });
});

describe("queryTerms", () => {
  it("drops English filler", () => {
    expect(queryTerms("how does the writer work")).not.toContain("the");
  });

  it("keeps programming words English would call filler", () => {
    /*
     * The trap an aggressive stopword list falls into. `class`, `type` and `return` are
     * real search terms in a codebase, and dropping them means a search for `class`
     * returns nothing at all.
     */
    for (const term of ["class", "type", "function", "return"]) {
      expect(queryTerms(`find the ${term} here`), term).toContain(term);
    }
  });

  it("deduplicates", () => {
    expect(queryTerms("cache cache cache").filter((t) => t === "cache").length).toBe(1);
  });

  it("drops single characters", () => {
    expect(queryTerms("a b writer")).toEqual(["writer"]);
  });
});

describe("keywordRanking", () => {
  const docs = [
    { id: "one", text: "the writer holds expectedMtimeMs and serialises every write" },
    { id: "two", text: "an unrelated component that renders a chip" },
    { id: "three", text: "expectedMtimeMs is required, never optional" },
  ];

  it("ranks by how many distinct query terms appear", () => {
    expect(keywordRanking(docs, "expectedMtimeMs writer")[0]).toBe("one");
  });

  it("counts breadth of match, not repetition", () => {
    /*
     * Counting every hit lets one chunk repeating a single term twenty times beat a chunk
     * matching every term once — backwards, since repetition is often just a loop variable
     * and breadth is the better signal.
     */
    const ranked = keywordRanking(
      [
        { id: "repeats", text: "cache cache cache cache cache cache" },
        { id: "broad", text: "cache invalidation strategy" },
      ],
      "cache invalidation strategy",
    );
    expect(ranked[0]).toBe("broad");
  });

  it("finds an exact identifier, which is what semantic search is worst at", () => {
    const ranked = keywordRanking(docs, "expectedMtimeMs");
    expect(ranked).toContain("three");
    expect(ranked).not.toContain("two");
  });

  it("drops documents that match nothing rather than ranking them last", () => {
    // Fusion works on positions, so a tail of zero-scoring documents would contribute
    // rank information that means nothing and dilute the other ranker.
    expect(keywordRanking(docs, "chip")).toEqual(["two"]);
  });

  it("returns nothing when the query is all filler", () => {
    expect(keywordRanking(docs, "the a of to")).toEqual([]);
  });

  it("is deterministic for tied scores", () => {
    const tied = [
      { id: "zzz", text: "cache" },
      { id: "aaa", text: "cache" },
    ];
    expect(keywordRanking(tied, "cache")).toEqual(["aaa", "zzz"]);
  });

  it("does not let a paragraph about everything outrank the code that answers", () => {
    /*
     * The failure this ranker shipped with, and the reason for the length correction.
     *
     * The README is not wrong and not spam — it genuinely describes the writer, so it
     * genuinely matches the query. It wins on breadth alone only because it is long enough
     * to mention four subsystems, and a longer text has more chances to contain any given
     * word. On the first real repository the app indexed, that put `README.md` at the top of
     * every single citation, and the source the plan was supposed to be grounded in sat one
     * rank below, outside the excerpt budget.
     *
     * Nothing failed when that happened, which is why this is a test and not a comment.
     */
    const ranked = keywordRanking(
      [
        {
          id: "README.md",
          text:
            "Writes carry an expectedMtimeMs precondition so a file changed on disk is a " +
            "conflict. Card order uses sparse integers. The theme persists in a cookie. " +
            "Snapshot before every apply, and auto-commit can never fail an apply.",
        },
        {
          id: "lib/writer.ts",
          text: "export async function write(path, body, expectedMtimeMs) { assertUnchanged(); }",
        },
      ],
      "expectedMtimeMs",
    );
    expect(ranked[0]).toBe("lib/writer.ts");
  });

  it("separates two equally broad matches by which says it in fewer words", () => {
    // The same rule stated without the story: same terms matched, shorter text wins,
    // because the shorter one is the denser evidence and the better thing to quote.
    const ranked = keywordRanking(
      [
        { id: "long", text: `cache invalidation strategy ${"and some other prose ".repeat(20)}` },
        { id: "short", text: "cache invalidation strategy" },
      ],
      "cache invalidation strategy",
    );
    expect(ranked[0]).toBe("short");
  });

  it("still ranks a broad match over a long one that repeats a single term", () => {
    /*
     * Guards the correction against overshooting. Length is DISCOUNTED, not punished: a
     * chunk matching every term must keep beating a shorter one matching a single term,
     * or the fix for prose has quietly become a preference for brevity over relevance.
     */
    const ranked = keywordRanking(
      [
        { id: "one-term-short", text: "cache" },
        { id: "all-terms-longer", text: "cache invalidation strategy, described at some length" },
      ],
      "cache invalidation strategy",
    );
    expect(ranked[0]).toBe("all-terms-longer");
  });

  it("scores an all-empty corpus without producing NaN", () => {
    // 0/0 in the length factor would make every score NaN, and NaN comparisons sort
    // unpredictably — a ranking that reshuffles is one no regression can be proved against.
    expect(keywordRanking([{ id: "empty", text: "" }], "cache")).toEqual([]);
  });
});

describe("similarity", () => {
  it("dot product of identical unit vectors is 1", () => {
    const v = normalize(new Float32Array([3, 4]));
    expect(dot(v, v)).toBeCloseTo(1, 5);
  });

  it("orthogonal unit vectors score 0", () => {
    expect(dot(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });

  it("normalize makes a vector unit length", () => {
    expect(isNormalized(normalize(new Float32Array([5, 12])))).toBe(true);
  });

  it("normalize leaves a zero vector alone instead of producing NaN", () => {
    // NaN would poison every comparison it takes part in and sort unpredictably — a wrong
    // answer rather than a missing one.
    expect([...normalize(new Float32Array([0, 0, 0]))]).toEqual([0, 0, 0]);
  });

  it("isNormalized rejects a vector that is not unit length", () => {
    expect(isNormalized(new Float32Array([3, 4]))).toBe(false);
  });

  it("ranks ids by similarity to the query, best first", () => {
    // Rows: exactly the query, orthogonal, opposite.
    const vectors = new Float32Array([1, 0, 0, 1, -1, 0]);
    const ranked = rankBySimilarity(
      ["same", "ortho", "opposite"],
      vectors,
      2,
      new Float32Array([1, 0]),
      3,
    );

    expect(ranked.map((r) => r.id)).toEqual(["same", "ortho", "opposite"]);
    expect(ranked[0]?.score).toBeCloseTo(1, 5);
  });

  it("respects the limit", () => {
    const vectors = new Float32Array([1, 0, 0, 1]);
    expect(rankBySimilarity(["a", "b"], vectors, 2, new Float32Array([1, 0]), 1).length).toBe(1);
  });

  it("stops rather than reading past the end of a short buffer", () => {
    // A truncated vectors file must not rank chunks against whatever bytes follow it.
    const ranked = rankBySimilarity(
      ["a", "b", "c"],
      new Float32Array([1, 0]),
      2,
      new Float32Array([1, 0]),
      5,
    );
    expect(ranked.map((r) => r.id)).toEqual(["a"]);
  });

  it("returns nothing for zero dims or no ids", () => {
    expect(rankBySimilarity([], new Float32Array(0), 2, new Float32Array([1]), 5)).toEqual([]);
    expect(rankBySimilarity(["a"], new Float32Array([1]), 0, new Float32Array([1]), 5)).toEqual(
      [],
    );
  });

  it("breaks tied scores by id, so a rebuild ranks the same way", () => {
    const vectors = new Float32Array([1, 0, 1, 0]);
    const ranked = rankBySimilarity(["zzz", "aaa"], vectors, 2, new Float32Array([1, 0]), 2);
    expect(ranked.map((r) => r.id)).toEqual(["aaa", "zzz"]);
  });
});

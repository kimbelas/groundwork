/**
 * Retrieval evaluation with the embedding model loaded.
 *
 * Run: `pnpm eval:retrieval`
 *
 * ## Why this is a script and not a test
 *
 * The unit suite gates the keyword ranker, which needs nothing and runs in milliseconds.
 * Gating the semantic half there would mean the test suite downloading a few hundred
 * megabytes of model weights — and a suite that needs a network fails for reasons that have
 * nothing to do with the code. The honest alternative is to skip when the model is missing,
 * and a skipped quality gate is one nobody notices has stopped running.
 *
 * So the numbers that need the model are produced deliberately, here, and printed side by
 * side with the keyword baseline. What matters is not either number alone but the gap: if
 * hybrid is not beating keyword on the paraphrased questions, the semantic half is carrying
 * its cost and earning nothing.
 *
 * Exits non-zero if hybrid does worse than keyword, which would mean fusion is actively
 * hurting — the one outcome that should stop a commit.
 */

/*
 * Run through tsx, not node.
 *
 * The corpus and the retrieval modules are TypeScript, and duplicating the corpus in JS
 * would give the gate and this script two sets of numbers that cannot be compared. An
 * in-process `register("tsx/esm", ...)` was the first attempt and Node rejects it - tsx
 * needs `--import`, since `--loader` was deprecated in Node 20. The package script uses
 * `tsx` directly, which is simpler than reproducing the flag here.
 */

import { CASES, DOCS, PARAPHRASES } from "../tests/fixtures/retrieval-corpus.ts";
import { formatReport, scoreEval } from "../lib/index/eval.ts";
import { keywordRanking } from "../lib/index/keyword.ts";
import { rrfFuse } from "../lib/index/fusion.ts";
import { DIMS, embed, embedBatch, embeddingsAvailable } from "../lib/index/embeddings.ts";
import { rankBySimilarity } from "../lib/index/similarity.ts";

const K = Number(process.env.EVAL_K ?? 5);

const availability = await embeddingsAvailable();
if (!availability.ready) {
  console.error(`Embeddings unavailable: ${availability.reason}`);
  console.error("Keyword-only numbers follow; the hybrid comparison needs the model.");
}

console.log(`Embedding ${DOCS.length} chunks...`);
const vectors = availability.ready ? await embedBatch(DOCS.map((d) => d.text)) : null;
const ids = DOCS.map((d) => d.id);

/** Cache query vectors: the same query is scored at several k values. */
const queryVectors = new Map();
async function queryVector(query) {
  if (!queryVectors.has(query)) queryVectors.set(query, await embed(query));
  return queryVectors.get(query);
}

async function hybrid(query) {
  const keyword = keywordRanking(DOCS, query);
  if (!vectors) return keyword;

  const qv = await queryVector(query);
  if (!qv) return keyword;

  const semantic = rankBySimilarity(ids, vectors, DIMS, qv, DOCS.length).map((s) => s.id);
  // Unweighted, matching lib/index/retrieve.ts. A coverage-weighted variant was measured
  // here and scored worse; the reasoning is recorded in that file.
  return rrfFuse([semantic, keyword], DOCS.length);
}

async function semanticOnly(query) {
  if (!vectors) return [];
  const qv = await queryVector(query);
  if (!qv) return [];
  return rankBySimilarity(ids, vectors, DIMS, qv, DOCS.length).map((s) => s.id);
}

/** Pre-resolve every ranking, so scoring stays the pure synchronous function it is. */
async function rankings(cases, rank) {
  const out = new Map();
  for (const c of cases) out.set(c.query, await rank(c.query));
  return (query) => out.get(query) ?? [];
}

async function report(label, cases) {
  const kw = scoreEval(cases, (q) => keywordRanking(DOCS, q), K);
  const sem = scoreEval(cases, await rankings(cases, semanticOnly), K);
  const hyb = scoreEval(cases, await rankings(cases, hybrid), K);

  console.log(`\n── ${label} (${cases.length} queries, k=${K})`);
  console.log(formatReport("  keyword ", kw));
  if (vectors) {
    console.log(formatReport("  semantic", sem));
    console.log(formatReport("  hybrid  ", hyb));
  }
  return { kw, sem, hyb };
}

const exact = await report("Exact-term queries", CASES);
const paraphrased = await report("Paraphrased queries", PARAPHRASES);

if (!vectors) process.exit(0);

console.log("\n── What the semantic half buys");
const gain = paraphrased.hyb.recall - paraphrased.kw.recall;
console.log(
  `  paraphrase recall: keyword ${(paraphrased.kw.recall * 100).toFixed(1)}% → ` +
    `hybrid ${(paraphrased.hyb.recall * 100).toFixed(1)}% (${gain >= 0 ? "+" : ""}${(
      gain * 100
    ).toFixed(1)} points)`,
);

/*
 * The only failing condition.
 *
 * Not "hybrid must reach X%" — that number depends on the machine, the model build and the
 * corpus, and a threshold like it gets edited downward the first time it is inconvenient.
 * The claim worth enforcing is directional: fusing two rankers must not be worse than the
 * cheaper ranker alone. If it is, fusion is hurting and the wiring is wrong.
 */
const regressed =
  exact.hyb.recall < exact.kw.recall - 1e-9 ||
  paraphrased.hyb.recall < paraphrased.kw.recall - 1e-9;

if (regressed) {
  console.error("\nFAIL: hybrid retrieval scores below keyword-only. Fusion is hurting.");
  process.exit(1);
}

console.log("\nOK: hybrid is at least as good as keyword on both sets.");

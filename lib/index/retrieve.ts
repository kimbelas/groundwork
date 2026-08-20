import type { CodeChunk } from "./chunk";
import { embed, embeddingsAvailable } from "./embeddings";
import { rrfFuse } from "./fusion";
import { keywordRanking } from "./keyword";
import { rankBySimilarity } from "./similarity";
import type { StoredIndex } from "./store";

/**
 * Searching the index.
 *
 * Hybrid retrieval: rank by meaning, rank by exact terms, then fuse the two rankings with
 * Reciprocal Rank Fusion. Each half covers the other's blind spot, and code needs both
 * more than prose does.
 *
 * Semantic search finds the right code when the question does not share its vocabulary —
 * "how do we stop two writers clobbering each other" has almost no words in common with
 * `expectedMtimeMs`. Keyword search finds the exact identifier when the question *is* the
 * vocabulary, which is what an embedding model is worst at: ask it for `expectedMtimeMs`
 * and it returns things *about* preconditions rather than the four places that symbol
 * appears.
 *
 * RRF combines them by rank position, never by their own scores, so a cosine similarity
 * and a term-hit count never have to be forced onto one scale.
 */

export interface Hit {
  chunk: CodeChunk;
  /** Where this came from — shown to the user, because "why this result" matters. */
  via: "both" | "semantic" | "keyword";
}

export interface SearchResult {
  hits: Hit[];
  /** True when semantic ranking took part. False means keyword-only, and the user is told. */
  semantic: boolean;
  /** Why semantic was unavailable, when it was not used. */
  degradedReason?: string;
}

/**
 * How many candidates each ranker contributes before fusion.
 *
 * Wider than `limit` on purpose. Fusion can only promote something one ranker placed low,
 * so a candidate list truncated at the final size throws away exactly the results the
 * fusion exists to rescue.
 */
const CANDIDATES = 50;

export interface SearchOptions {
  limit?: number;
  /** Restrict to files whose path starts with one of these. */
  underPaths?: string[];
}

function filterChunks(chunks: CodeChunk[], underPaths?: string[]): CodeChunk[] {
  if (!underPaths || underPaths.length === 0) return chunks;
  const prefixes = underPaths.map((p) => p.replace(/^\/+|\/+$/g, ""));
  return chunks.filter((c) => prefixes.some((p) => c.file === p || c.file.startsWith(`${p}/`)));
}

/**
 * Search the index for a query.
 *
 * Never throws for lack of a model. An index built without embeddings, or a machine where
 * the model will not load, returns keyword results and says `semantic: false` — because
 * the alternative is a search box that fails on a fresh install, and keyword search over
 * chunked source is genuinely useful on its own.
 */
export async function search(
  index: StoredIndex,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const limit = Math.max(1, opts.limit ?? 10);
  const trimmed = query.trim();
  if (trimmed.length === 0) return { hits: [], semantic: false };

  const candidates = filterChunks(index.chunks, opts.underPaths);
  if (candidates.length === 0) return { hits: [], semantic: false };

  const byId = new Map(candidates.map((c) => [c.id, c]));

  const keyword = keywordRanking(
    candidates.map((c) => ({ id: c.id, text: c.text })),
    trimmed,
  ).slice(0, CANDIDATES);

  let semanticIds: string[] = [];
  let degradedReason: string | undefined;

  if (!index.manifest.keywordOnly && index.vectors.length > 0) {
    const queryVec = await embed(trimmed);
    if (queryVec) {
      /*
       * Similarity is ranked over the WHOLE index, then filtered.
       *
       * The vectors buffer is positional — row N belongs to `index.chunks[N]` — so a
       * filtered subset cannot be scored without either rebuilding a buffer or carrying
       * an index map. Ranking everything and dropping what does not match is one pass
       * over a few thousand dot products, which is cheaper than the allocation.
       */
      semanticIds = rankBySimilarity(
        index.chunks.map((c) => c.id),
        index.vectors,
        index.manifest.dims,
        queryVec,
        CANDIDATES + candidates.length,
      )
        .map((s) => s.id)
        .filter((id) => byId.has(id))
        .slice(0, CANDIDATES);
    } else {
      degradedReason = (await embeddingsAvailable()).reason;
    }
  } else {
    degradedReason =
      "This index was built without embeddings, so results come from keyword matching only.";
  }

  /*
   * Plain RRF, both rankers equal. This was measured, not assumed.
   *
   * On the eval corpus, hybrid beats keyword decisively on paraphrased questions (40% ->
   * 80% recall) and costs a little MRR against keyword alone on exact-term ones (1.000 ->
   * 0.958). Semantic alone scores 100% on the paraphrases, so fusion does give up some of
   * the semantic half's advantage there - and that is a real trade, not a bug: keyword is
   * the only ranker that finds an exact identifier, and dropping it would lose the lookups
   * this is used for most.
   *
   * A weighted version was tried, scaling the keyword ranking by the fraction of query
   * terms its best match contained, on the theory that a ranker matching two words of
   * eight is guessing. It made things worse: exact-term MRR fell to 0.917 and paraphrase
   * recall did not move. Coverage turns out to penalise LONG queries rather than wrong
   * ones - no single chunk contains every term of a multi-word question - so it downweighted
   * keyword precisely where keyword was strongest.
   *
   * `rrfFuse` still takes weights, because the finding is that this particular signal is
   * wrong, not that weighting is. Tuning it properly needs a corpus far larger than
   * seventeen queries; anything fitted to this one is fitted to noise.
   */
  const rankings = semanticIds.length > 0 ? [semanticIds, keyword] : [keyword];
  const fused = rrfFuse(rankings, limit);

  const inSemantic = new Set(semanticIds);
  const inKeyword = new Set(keyword);

  const hits: Hit[] = [];
  for (const id of fused) {
    const chunk = byId.get(id);
    if (!chunk) continue;
    const s = inSemantic.has(id);
    const k = inKeyword.has(id);
    hits.push({ chunk, via: s && k ? "both" : s ? "semantic" : "keyword" });
  }

  return {
    hits,
    semantic: semanticIds.length > 0,
    ...(degradedReason ? { degradedReason } : {}),
  };
}

/**
 * A citation a grounding check can verify.
 *
 * `file:line` plus the exact text, because P3's rule is that a claim about the code must
 * quote a real line — checked by plain string match with no model involved, so the check
 * itself cannot hallucinate. That only works if what the model was shown carries its
 * position and its bytes unaltered.
 */
export function citation(chunk: CodeChunk): string {
  return `${chunk.file}:${chunk.startLine}-${chunk.endLine}`;
}

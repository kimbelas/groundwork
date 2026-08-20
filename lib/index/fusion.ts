/**
 * Reciprocal Rank Fusion.
 *
 * Merges several rankings of the same items into one, rewarding items that MULTIPLE
 * rankers place near the top. It scores by rank *position*, never by the rankers' own
 * numbers, which is the whole point: a cosine similarity of 0.82 and a keyword hit count
 * of 4 share no scale, and any attempt to normalise them into one is a fudge factor that
 * has to be retuned every time either ranker changes.
 *
 * Dependency-free on purpose — no embedding runtime, no model download — so the fusion rule
 * can be unit-tested on plain arrays. Ported from `ai-portfolio`, where it carries its own
 * recall numbers.
 *
 * Unweighted, deliberately. A per-ranking weight was added and measured, scaling the keyword
 * ranking by how much of the query its best match covered; it scored worse and the option is
 * gone rather than left sitting unused. `lib/index/retrieve.ts` records what was measured.
 */

/**
 * Dampens the difference between top ranks. At the conventional 60, rank 1 and rank 2 score
 * 1/60 and 1/61 - close enough that an item placed second by BOTH rankers outscores one
 * placed first by a single ranker and missed by the other. Presence in several rankings is
 * the evidence; one ranker's certainty is not.
 *
 * The precise claim matters, because the obvious stronger one is false: 1/60 + 1/62 exceeds
 * 2/61, so an item ranked first by one and last by the other still beats two mid placements.
 * The reciprocal is convex, so being seen at all carries most of the weight. RRF rewards
 * being found by several rankers - not agreement about position.
 */
export const RRF_K = 60;

/**
 * Fuse rankings into one list of at most `k` ids, best first.
 *
 * Takes and returns ids rather than objects, so this stays independent of what is being
 * ranked. Callers hold their own map.
 */
export function rrfFuse(rankings: string[][], k: number, rrfK = RRF_K): string[] {
  const scores = new Map<string, number>();

  for (const ranking of rankings) {
    ranking.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (rrfK + rank));
    });
  }

  return (
    [...scores.entries()]
      /*
       * Ties break by id, not by insertion order.
       *
       * Two items with identical scores are common — the same item at the same rank in
       * two lists, or two items each seen once at the same position. `Array.prototype.sort`
       * is stable, so insertion order would decide, and insertion order here follows Map
       * iteration, which follows whichever ranker happened to run first. That made the
       * result depend on argument order and turned "did retrieval change?" into a question
       * nobody could answer. A derived index that reshuffles is an index that churns.
       */
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, k)
      .map(([id]) => id)
  );
}

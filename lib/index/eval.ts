/**
 * Measuring retrieval, so "grounded in the code" is a number instead of a claim.
 *
 * Retrieval quality has no compile error and no failing test unless one is written. Change
 * the chunk size, the stopword list, the fusion constant, or swap the model, and nothing
 * breaks — results just get quietly worse, and the symptom shows up much later as planning
 * that cites the wrong file. A recall gate is the only thing standing between a tuning
 * change and that outcome.
 *
 * Pure: it takes rankings and expectations and returns numbers. The corpus and the floors
 * live with the tests that enforce them.
 */

export interface EvalCase {
  query: string;
  /** Chunk ids that would satisfy this query. Any one of them counts as a hit. */
  relevant: string[];
}

export interface CaseResult extends EvalCase {
  returned: string[];
  hit: boolean;
  /** 1-based position of the first relevant result, or null when none was returned. */
  rank: number | null;
}

export interface EvalReport {
  k: number;
  cases: CaseResult[];
  /** Fraction of queries where at least one relevant chunk appeared in the top k. */
  recall: number;
  /**
   * Mean reciprocal rank. Recall says whether the answer was there; MRR says how far the
   * reader had to look. A change that keeps recall flat while pushing every hit from rank
   * one to rank five is a real regression, and recall alone cannot see it.
   */
  mrr: number;
  misses: string[];
}

/** Position of the first relevant id, 1-based, or null. */
export function firstRelevantRank(returned: string[], relevant: string[]): number | null {
  const wanted = new Set(relevant);
  for (let i = 0; i < returned.length; i += 1) {
    if (wanted.has(returned[i] as string)) return i + 1;
  }
  return null;
}

/**
 * Score a set of queries against what retrieval returned.
 *
 * `returnedFor` is passed in rather than a retriever being called here, so the same
 * scoring runs over keyword-only results, hybrid results, or a recorded baseline.
 */
export function scoreEval(
  cases: EvalCase[],
  returnedFor: (query: string) => string[],
  k: number,
): EvalReport {
  const results: CaseResult[] = cases.map((c) => {
    const returned = returnedFor(c.query).slice(0, k);
    const rank = firstRelevantRank(returned, c.relevant);
    return { ...c, returned, rank, hit: rank !== null };
  });

  const hits = results.filter((r) => r.hit).length;
  const reciprocal = results.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0);

  return {
    k,
    cases: results,
    // An empty case list scores 0 rather than NaN. A gate comparing NaN to a floor is
    // always false, so an empty corpus would silently pass every threshold.
    recall: results.length === 0 ? 0 : hits / results.length,
    mrr: results.length === 0 ? 0 : reciprocal / results.length,
    misses: results.filter((r) => !r.hit).map((r) => r.query),
  };
}

/** One line per metric, for a script that prints its findings. */
export function formatReport(label: string, report: EvalReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    `${label}: recall@${report.k} ${pct(report.recall)}  MRR ${report.mrr.toFixed(3)}  ` +
      `(${report.cases.filter((c) => c.hit).length}/${report.cases.length})`,
  ];
  for (const miss of report.misses) lines.push(`  missed: ${miss}`);
  return lines.join("\n");
}

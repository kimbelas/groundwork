/**
 * Keyword ranking — the half of retrieval that works with no model at all.
 *
 * Semantic search is good at paraphrase and bad at exact tokens: ask about `expectedMtimeMs`
 * and an embedding model returns things *about* preconditions, which is not the same as the
 * four places that identifier appears. Code is full of exactly that kind of term. So the
 * keyword ranker is not a fallback here, it is a peer — and because it needs nothing but
 * string work, retrieval degrades to something genuinely useful when embeddings are
 * unavailable rather than to nothing.
 */

/**
 * Words carrying no signal in a query.
 *
 * Short list on purpose. Aggressive stopword removal is how a search for `class` or
 * `type` in a codebase returns nothing — programming languages are built out of words
 * English considers filler.
 */
const STOPWORDS = new Set(
  ("the a an of to for and or is are was were be been do does did how what which who whom " +
    "this that these those my your our their its it as with at in on by from up out " +
    "about into over after i me you we they he she")
    .split(" ")
    .filter(Boolean),
);

/**
 * Split text into searchable terms.
 *
 * Identifiers are split on case and separators as well as kept whole, so a query for
 * `mtime` finds `expectedMtimeMs` and a query for the full name still scores higher. That
 * asymmetry is deliberate: the whole identifier is one term and each part is another, so
 * a chunk containing the exact name matches on more terms than one that merely shares a
 * word.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];

  for (const raw of text.toLowerCase().match(/[a-z0-9_$]+/g) ?? []) {
    if (raw.length === 0) continue;
    out.push(raw);
  }

  // camelCase and PascalCase, split before the original is lowercased away.
  for (const ident of text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
    const parts = ident.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    if (parts.length < 2) continue;
    for (const part of parts) out.push(part.toLowerCase());
  }

  // snake_case and kebab-case.
  for (const ident of text.match(/[a-z0-9]+(?:[_-][a-z0-9]+)+/gi) ?? []) {
    for (const part of ident.toLowerCase().split(/[_-]/)) out.push(part);
  }

  return out;
}

/** Query terms worth matching on: tokenized, stopwords dropped, deduplicated. */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const t of tokenize(query)) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    seen.add(t);
  }
  return [...seen];
}

export interface KeywordDoc {
  id: string;
  text: string;
}

/**
 * Score how well each document matches the query, best first.
 *
 * The score is the number of DISTINCT query terms present, not the total number of hits.
 * Counting every hit lets one chunk that repeats a single term twenty times beat a chunk
 * that matches every term once, which is backwards — breadth of match is the better
 * signal, and repetition is often just a loop variable.
 *
 * Documents matching nothing are dropped rather than ranked last. Fusion works on
 * positions, so a tail of zero-scoring documents would contribute rank information that
 * means nothing and would dilute the other ranker.
 */
export function keywordRanking(docs: KeywordDoc[], query: string): string[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const wanted = new Set(terms);
  const scored: { id: string; score: number }[] = [];

  for (const doc of docs) {
    const present = new Set<string>();
    for (const t of tokenize(doc.text)) {
      if (wanted.has(t)) present.add(t);
    }
    if (present.size > 0) scored.push({ id: doc.id, score: present.size });
  }

  // Ties break by id so the ranking is reproducible; see the note in fusion.ts.
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.map((s) => s.id);
}

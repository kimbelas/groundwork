/**
 * Vector math for ranking. Pure, and deliberately the whole of it.
 *
 * A "vector database" over a few thousand chunks is an array and a loop. pgvector and the
 * hosted services do exactly this, indexed so it stays fast over millions of rows — and a
 * repo is not millions of rows. Brute force over 5,000 chunks is a few milliseconds, needs
 * no server, and cannot drift out of sync with the vault. Adding a database here would be
 * buying an index-maintenance problem to solve a loop.
 */

/**
 * Cosine similarity, for vectors that are already unit length.
 *
 * The embedding model normalises its output, so magnitudes are 1 and the cosine is just
 * the dot product. Dividing by magnitudes anyway would cost two extra passes and a square
 * root per comparison to compute a division by 1 — and would hide, rather than catch, a
 * caller passing something that is not normalised.
 */
export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += (a[i] as number) * (b[i] as number);
  return sum;
}

/** True when a vector is unit length, within floating-point tolerance. */
export function isNormalized(v: Float32Array, tolerance = 1e-3): boolean {
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) sum += (v[i] as number) * (v[i] as number);
  return Math.abs(Math.sqrt(sum) - 1) <= tolerance;
}

/**
 * Scale a vector to unit length.
 *
 * Used on anything not known to be normalised already. A zero vector comes back unchanged
 * rather than as NaN: it means "no signal", and NaN would poison every comparison it takes
 * part in and sort unpredictably.
 */
export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) sum += (v[i] as number) * (v[i] as number);
  const mag = Math.sqrt(sum);
  if (mag === 0) return v;

  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 1) out[i] = (v[i] as number) / mag;
  return out;
}

/**
 * Rank ids by similarity to `query`, best first.
 *
 * `vectors` is one flat buffer of `count × dims`, not an array of arrays. Chunk vectors
 * are read straight off disk in that layout and a repo has thousands of them, so building
 * an array of Float32Arrays first would allocate thousands of objects per search for no
 * benefit — the loop reads the flat buffer directly.
 */
export function rankBySimilarity(
  ids: string[],
  vectors: Float32Array,
  dims: number,
  query: Float32Array,
  limit: number,
): { id: string; score: number }[] {
  if (dims <= 0 || ids.length === 0) return [];

  const scored: { id: string; score: number }[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const offset = i * dims;
    if (offset + dims > vectors.length) break;

    let sum = 0;
    for (let d = 0; d < dims; d += 1) {
      sum += (vectors[offset + d] as number) * (query[d] as number);
    }
    scored.push({ id: ids[i] as string, score: sum });
  }

  // Ties break by id so a rebuild produces the same ranking; see the note in fusion.ts.
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.slice(0, limit);
}

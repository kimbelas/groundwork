/**
 * Sparse ordering for board cards.
 *
 * Cards carry `order` as sparse integers (100, 200, 300...) so the common case —
 * dropping a card between two others — rewrites exactly one file. Dense sequential
 * ordering would renumber the whole column on every drag, turning each move into a
 * multi-file diff and defeating the "one apply, one reviewable commit" guarantee.
 *
 * Pure and integer-only. Floating-point midpoints would drift toward denormals after
 * enough drags into the same gap, and a fraction in YAML reads badly by hand.
 */

export const ORDER_STEP = 100;

/**
 * The order value for a card landing between two neighbours.
 *
 * Returns `null` when the gap has closed and the column must be renumbered first —
 * the caller decides, because renumbering touches several files.
 */
export function orderBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return ORDER_STEP;

  if (before === null) {
    // Landing at the head of the column: halve the current first value.
    if (after === null) return ORDER_STEP;
    if (after <= 1) return null;
    return Math.floor(after / 2);
  }

  if (after === null) return before + ORDER_STEP;

  const gap = after - before;
  if (gap <= 1) return null;
  return before + Math.floor(gap / 2);
}

export interface Ordered {
  id: number;
  order: number;
}

/** Fresh sparse values for a column, preserving current relative order. */
export function renumber<T extends Ordered>(cards: readonly T[]): { id: number; order: number }[] {
  return [...cards]
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .map((c, i) => ({ id: c.id, order: (i + 1) * ORDER_STEP }));
}

/**
 * Resolve a drop at `index` within `columnCards` to an order value.
 *
 * `columnCards` must already exclude the card being moved, so an in-column move sees
 * the same neighbour list an incoming card would.
 */
export function orderForIndex(
  columnCards: readonly Ordered[],
  index: number,
): { order: number } | { renumber: true } {
  const sorted = [...columnCards].sort((a, b) => a.order - b.order || a.id - b.id);
  const clamped = Math.max(0, Math.min(index, sorted.length));

  const before = clamped === 0 ? null : (sorted[clamped - 1]?.order ?? null);
  const after = clamped >= sorted.length ? null : (sorted[clamped]?.order ?? null);

  const order = orderBetween(before, after);
  return order === null ? { renumber: true } : { order };
}

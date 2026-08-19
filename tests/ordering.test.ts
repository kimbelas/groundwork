import { describe, expect, it } from "vitest";

import { ORDER_STEP, orderBetween, orderForIndex, renumber } from "@/lib/ordering";

/**
 * Ordering is what keeps a drag to a one-file diff. The interesting cases are all about
 * gap exhaustion: repeatedly dropping into the same slot must eventually ask for a
 * renumber rather than silently colliding or drifting into fractions.
 */

describe("orderBetween", () => {
  it("seeds an empty column", () => {
    expect(orderBetween(null, null)).toBe(ORDER_STEP);
  });

  it("appends past the last card", () => {
    expect(orderBetween(300, null)).toBe(400);
  });

  it("halves ahead of the first card", () => {
    expect(orderBetween(null, 100)).toBe(50);
  });

  it("takes the midpoint between neighbours", () => {
    expect(orderBetween(100, 200)).toBe(150);
    expect(orderBetween(100, 300)).toBe(200);
  });

  it("always returns an integer", () => {
    for (const [a, b] of [
      [100, 101],
      [100, 103],
      [7, 12],
      [1, 1000],
    ] as const) {
      const v = orderBetween(a, b);
      if (v !== null) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("asks for a renumber when the gap has closed", () => {
    expect(orderBetween(100, 101)).toBeNull();
    expect(orderBetween(100, 100)).toBeNull();
    expect(orderBetween(null, 1)).toBeNull();
    expect(orderBetween(null, 0)).toBeNull();
  });

  it("survives repeated inserts into the same gap until the gap is spent", () => {
    let before = 100;
    const after = 200;
    let inserts = 0;

    for (;;) {
      const next = orderBetween(before, after);
      if (next === null) break;
      expect(next).toBeGreaterThan(before);
      expect(next).toBeLessThan(after);
      before = next;
      inserts += 1;
      if (inserts > 100) throw new Error("gap never closed — ordering would never renumber");
    }

    // A 100-wide gap halves down to nothing in a handful of drags, then hands over.
    expect(inserts).toBeGreaterThan(3);
    expect(inserts).toBeLessThan(10);
  });
});

describe("renumber", () => {
  it("re-spaces while preserving relative order", () => {
    expect(
      renumber([
        { id: 3, order: 150 },
        { id: 1, order: 100 },
        { id: 2, order: 101 },
      ]),
    ).toEqual([
      { id: 1, order: 100 },
      { id: 2, order: 200 },
      { id: 3, order: 300 },
    ]);
  });

  it("breaks order ties by id so the result is deterministic", () => {
    expect(
      renumber([
        { id: 9, order: 100 },
        { id: 4, order: 100 },
      ]),
    ).toEqual([
      { id: 4, order: 100 },
      { id: 9, order: 200 },
    ]);
  });

  it("does not mutate its input", () => {
    const input = [{ id: 1, order: 500 }];
    renumber(input);
    expect(input[0]?.order).toBe(500);
  });

  it("handles an empty column", () => {
    expect(renumber([])).toEqual([]);
  });
});

describe("orderForIndex", () => {
  const column = [
    { id: 1, order: 100 },
    { id: 2, order: 200 },
    { id: 3, order: 300 },
  ];

  it("places at the head, middle and tail", () => {
    expect(orderForIndex(column, 0)).toEqual({ order: 50 });
    expect(orderForIndex(column, 1)).toEqual({ order: 150 });
    expect(orderForIndex(column, 3)).toEqual({ order: 400 });
  });

  it("clamps an index past the end", () => {
    expect(orderForIndex(column, 99)).toEqual({ order: 400 });
  });

  it("clamps a negative index", () => {
    expect(orderForIndex(column, -5)).toEqual({ order: 50 });
  });

  it("seeds an empty column", () => {
    expect(orderForIndex([], 0)).toEqual({ order: ORDER_STEP });
  });

  it("signals a renumber when neighbours are adjacent", () => {
    expect(
      orderForIndex(
        [
          { id: 1, order: 100 },
          { id: 2, order: 101 },
        ],
        1,
      ),
    ).toEqual({ renumber: true });
  });

  it("reads unsorted input correctly", () => {
    const shuffled = [
      { id: 3, order: 300 },
      { id: 1, order: 100 },
      { id: 2, order: 200 },
    ];
    expect(orderForIndex(shuffled, 1)).toEqual({ order: 150 });
  });
});

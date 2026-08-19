import { describe, expect, it } from "vitest";

import { resolveOptimistic } from "@/lib/optimistic";

describe("resolveOptimistic", () => {
  it("shows the server value when nothing is in flight", () => {
    expect(resolveOptimistic("idea", undefined)).toBe("idea");
  });

  it("shows the optimistic value while the server has not caught up", () => {
    // The round trip is still running. Showing the server value here would flash the
    // control back to the old one the moment it was changed.
    expect(resolveOptimistic("idea", { value: "building", base: "idea" })).toBe("building");
  });

  it("hands back to the server once it confirms", () => {
    expect(resolveOptimistic("building", { value: "building", base: "idea" })).toBe("building");
  });

  /**
   * The case that motivates tracking `base` at all.
   *
   * Someone edits the vault in Obsidian while the page is open, or an AI proposal is
   * applied. A refresh brings a third value — neither what was there nor what was chosen.
   * An override that only expires on agreement would still be sitting in state and would
   * mask it, showing a value no longer in the file as though it were current.
   */
  it("yields to an outside change it never saw", () => {
    expect(resolveOptimistic("shipped", { value: "building", base: "idea" })).toBe("shipped");
  });

  it("yields even when the outside change happens to be the old value again", () => {
    // Server moved away and back. Still an outside change, and still not ours to override.
    expect(resolveOptimistic("paused", { value: "building", base: "idea" })).toBe("paused");
  });

  it("works for values that are not strings", () => {
    expect(resolveOptimistic(3, { value: 7, base: 3 })).toBe(7);
    expect(resolveOptimistic(9, { value: 7, base: 3 })).toBe(9);
    expect(resolveOptimistic(null, { value: 2, base: null })).toBe(2);
  });

  it("compares by identity, so an equal-looking object does not count as agreement", () => {
    // Object.is, not a deep compare: two structurally equal objects from separate fetches
    // are different values, and treating them as the same would expire an override early.
    const base = { n: 1 };
    const value = { n: 2 };
    expect(resolveOptimistic({ n: 1 }, { value, base })).toEqual({ n: 1 });
    expect(resolveOptimistic(base, { value, base })).toBe(value);
  });
});

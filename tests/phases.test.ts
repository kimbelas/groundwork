import { describe, expect, it } from "vitest";

import { phaseChoices, phaseNumbers } from "@/lib/phases";
import type { Phase } from "@/lib/schema";

const phase = (n: number): Phase => ({ n, name: `Phase ${n}`, goal: "" });
const card = (p: number | null) => ({ phase: p });

describe("phaseNumbers", () => {
  it("takes the declared phases", () => {
    expect(phaseNumbers([phase(1), phase(2)], [])).toEqual([1, 2]);
  });

  it("includes a phase only a card references", () => {
    // The roadmap declares nothing, but a card sits in phase 3. Dropping it would make
    // that card invisible in the plan while it is plainly there on the board.
    expect(phaseNumbers([], [card(3), card(null)])).toEqual([3]);
  });

  it("merges the two without duplicating", () => {
    expect(phaseNumbers([phase(1), phase(2)], [card(2), card(5)])).toEqual([1, 2, 5]);
  });

  it("sorts numerically, not as strings", () => {
    // A plain sort() would give [1, 10, 2] and put phase 10 second.
    expect(phaseNumbers([phase(10), phase(2), phase(1)], [])).toEqual([1, 2, 10]);
  });

  it("includes the current value even when nothing else references it", () => {
    // This is the bug that made the control render blank: a card on phase 9 with a
    // roadmap that stops at 2 had no option matching its own value.
    expect(phaseNumbers([phase(1), phase(2)], [], 9)).toEqual([1, 2, 9]);
  });

  it("ignores unphased cards", () => {
    expect(phaseNumbers([], [card(null), card(null)])).toEqual([]);
  });

  it("is empty when there is nothing at all", () => {
    expect(phaseNumbers([], [])).toEqual([]);
  });
});

describe("phaseChoices", () => {
  it("matches phaseNumbers for a project that has phases", () => {
    const declared = [phase(1), phase(2)];
    const cards = [card(2), card(4)];
    expect(phaseChoices(declared, cards)).toEqual(phaseNumbers(declared, cards));
  });

  it("offers phase 1 when the project has none", () => {
    // Otherwise a brand-new project could never assign a first phase: the roadmap view is
    // read-only by design, so the card pane is the only place to do it.
    expect(phaseChoices([], [])).toEqual([1]);
  });

  it("does not invent a phase beyond the plan", () => {
    // Offering "one past the end" would let a dropdown create a phase the roadmap can only
    // label "Phase 3", with no name and no goal. Extending a plan belongs in roadmap.md.
    expect(phaseChoices([phase(1), phase(2)], [])).toEqual([1, 2]);
  });

  it("always contains the card's own phase, so the control is never blank", () => {
    for (const current of [1, 8, 9, 42]) {
      expect(phaseChoices([phase(1)], [], current)).toContain(current);
    }
  });
});

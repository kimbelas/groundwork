import { describe, expect, it } from "vitest";

import {
  archetypeLabel,
  confidenceChoices,
  confidenceLabel,
  healthLabel,
  likelihoodLabel,
  priorityLabel,
  progressLabel,
  progressPercent,
  sentenceCase,
  sizeLabel,
  stageLabel,
} from "@/lib/labels";
import { ARCHETYPES, HEALTHS, LIKELIHOODS, STAGES } from "@/lib/schema";

describe("priority and size labels", () => {
  it("turns codes into words", () => {
    expect(priorityLabel("P1")).toBe("High");
    expect(priorityLabel("P2")).toBe("Medium");
    expect(priorityLabel("P3")).toBe("Low");
    expect(sizeLabel("S")).toBe("Small");
    expect(sizeLabel("M")).toBe("Medium");
    expect(sizeLabel("L")).toBe("Large");
  });
});

describe("confidenceLabel", () => {
  it("reads as a percentage", () => {
    expect(confidenceLabel(0.8)).toBe("80% sure");
    expect(confidenceLabel(0)).toBe("0% sure");
    expect(confidenceLabel(1)).toBe("100% sure");
  });

  it("rounds rather than showing decimals", () => {
    expect(confidenceLabel(0.55)).toBe("55% sure");
    expect(confidenceLabel(0.333)).toBe("33% sure");
  });

  it("clamps values outside 0-1 instead of rendering nonsense", () => {
    expect(confidenceLabel(1.7)).toBe("100% sure");
    expect(confidenceLabel(-2)).toBe("0% sure");
  });
});

describe("progressLabel", () => {
  it("describes partial, complete and empty", () => {
    expect(progressLabel(1, 3)).toBe("1 of 3 done");
    expect(progressLabel(3, 3)).toBe("All 3 done");
    expect(progressLabel(0, 0)).toBe("No criteria yet");
  });

  it("does not claim completion at zero of zero", () => {
    expect(progressLabel(0, 0)).not.toContain("All");
  });
});

describe("progressPercent", () => {
  it("scales to 0-100", () => {
    expect(progressPercent(1, 4)).toBe(25);
    expect(progressPercent(2, 3)).toBe(67);
    expect(progressPercent(3, 3)).toBe(100);
  });

  it("returns zero for an empty checklist rather than NaN", () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(Number.isNaN(progressPercent(1, 0))).toBe(false);
  });

  it("clamps a count larger than the total", () => {
    expect(progressPercent(9, 3)).toBe(100);
    expect(progressPercent(-1, 3)).toBe(0);
  });
});

describe("sentenceCase", () => {
  it("capitalises for display without altering the rest", () => {
    expect(sentenceCase("shaping")).toBe("Shaping");
    expect(sentenceCase("saas-mvp")).toBe("Saas-mvp");
  });

  it("handles an empty string", () => {
    expect(sentenceCase("")).toBe("");
  });
});

/**
 * Every enum member has a word, proved against the enums themselves.
 *
 * The `Record<Union, string>` maps in `lib/labels.ts` already make an unlabelled member a
 * compile error, which is the stronger guarantee. This covers what a type cannot: someone
 * widening a parameter to `string`, or a label that exists but is empty — both of which put
 * a raw code like `saas-mvp` or `med` back on screen, which is the defect this fixes.
 *
 * Driven from the schema arrays rather than a copy, so adding a stage fails here rather
 * than shipping.
 */
describe("every enum reaches the screen as words", () => {
  const cases: Array<[string, readonly string[], (v: never) => string]> = [
    ["stage", STAGES, stageLabel as (v: never) => string],
    ["health", HEALTHS, healthLabel as (v: never) => string],
    ["archetype", ARCHETYPES, archetypeLabel as (v: never) => string],
    ["likelihood", LIKELIHOODS, likelihoodLabel as (v: never) => string],
  ];

  it.each(cases)("%s", (_name, values, label) => {
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      const shown = label(value as never);
      expect(shown, `${value} has no label`).toBeTruthy();
      // A label that is just the stored value is not a translation.
      expect(shown).not.toBe(value);
    }
  });

  it("does not sentence-case a hyphenated archetype into nonsense", () => {
    // sentenceCase("saas-mvp") gives "Saas-mvp", which looks like a failed attempt rather
    // than a product name. This is why archetypes get an explicit map.
    expect(archetypeLabel("saas-mvp")).toBe("SaaS MVP");
    expect(archetypeLabel("saas-mvp")).not.toBe(sentenceCase("saas-mvp"));
  });

  it("gives the risk scale a word for its middle value", () => {
    // "med" is not a word, and it reached the screen in the risk register as `med/high`.
    expect(likelihoodLabel("med")).toBe("Medium");
  });

  it("renames the stage that collided with a column and a phase", () => {
    // "Shaping" was simultaneously a stage, a default board column and a roadmap phase
    // name. Only the stage changes here; the other two are separate axes.
    expect(stageLabel("shaping")).toBe("Planning");
  });
});

describe("confidenceChoices", () => {
  it("offers every tenth, including zero", () => {
    // The old hard-coded list started at 0.1, so a card at 0 could not display its value.
    const choices = confidenceChoices(0.5);
    expect(choices).toContain(0);
    expect(choices).toContain(1);
    expect(choices.length).toBe(11);
  });

  it("always contains the card's own value, so the control is never blank", () => {
    // 0.85 is the shape an AI proposal produces. It matched no option, so the select
    // rendered empty while the file held a real number — and editing any other field then
    // submitted whatever that blank control resolved to.
    for (const value of [0, 0.85, 0.33, 1]) {
      expect(confidenceChoices(value)).toContain(Number(value.toFixed(2)));
    }
  });

  it("does not duplicate a value that is already a tenth", () => {
    expect(confidenceChoices(0.8).filter((c) => c === 0.8)).toHaveLength(1);
    expect(confidenceChoices(0.8)).toHaveLength(11);
  });

  it("stays sorted so the control reads low to high", () => {
    const choices = confidenceChoices(0.85);
    expect(choices).toEqual([...choices].sort((a, b) => a - b));
  });

  it("clamps a value outside the range rather than offering it", () => {
    expect(confidenceChoices(5)).toContain(1);
    expect(confidenceChoices(5).every((c) => c <= 1)).toBe(true);
    expect(confidenceChoices(-2).every((c) => c >= 0)).toBe(true);
  });
});

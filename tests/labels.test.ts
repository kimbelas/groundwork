import { describe, expect, it } from "vitest";

import {
  confidenceLabel,
  priorityLabel,
  progressLabel,
  progressPercent,
  sentenceCase,
  sizeLabel,
} from "@/lib/labels";

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

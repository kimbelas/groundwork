import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_HEADING,
  acceptanceRegion,
  addChecklistItem,
  descriptionOf,
  moveChecklistItem,
  parseChecklist,
  removeChecklistItem,
  replaceChecklistText,
  sanitiseCriterionText,
} from "@/lib/checklist";

/*
 * Every helper is held to the byte contract in the module comment: it changes the line(s)
 * it names and nothing else. So the assertions here are mostly about what did NOT change —
 * line counts, the other lines, the line endings — not only about the new text.
 */

const CARD = ["", "Description for Alpha.", "", "## Acceptance criteria", "", "- [ ] First", "- [x] Second"].join(
  "\n",
);

/** The new-card template, as `createCard` writes it after this change. */
const TEMPLATE = `\n\n${ACCEPTANCE_HEADING}\n`;

function linesOf(s: string): string[] {
  return s.split("\n");
}

/** Every line except the ones at `skip` is byte-identical between a and b. */
function sameExcept(a: string, b: string, skip: number[]): void {
  const la = linesOf(a);
  const lb = linesOf(b);
  expect(lb.length).toBe(la.length);
  la.forEach((line, i) => {
    if (skip.includes(i)) return;
    expect(lb[i]).toBe(line);
  });
}

describe("sanitiseCriterionText", () => {
  it("collapses line breaks to a space and trims", () => {
    expect(sanitiseCriterionText("  a\nb\r\nc  ")).toBe("a b c");
  });

  it("strips a pasted task-list prefix but keeps a bare [x] as text", () => {
    expect(sanitiseCriterionText("- [ ] foo")).toBe("foo");
    expect(sanitiseCriterionText("* [x] foo")).toBe("foo");
    expect(sanitiseCriterionText("[x] done")).toBe("[x] done");
  });

  it("returns an empty string for whitespace", () => {
    expect(sanitiseCriterionText("   \n ")).toBe("");
  });
});

describe("acceptanceRegion", () => {
  it("spans heading to last item", () => {
    expect(acceptanceRegion(CARD)).toEqual({ start: 3, end: 7, hasHeading: true });
  });

  it("is the heading alone when there are no items", () => {
    expect(acceptanceRegion(TEMPLATE)).toEqual({ start: 2, end: 3, hasHeading: true });
  });

  it("is the item span when there is no heading", () => {
    expect(acceptanceRegion("a\n- [ ] x\n- [ ] y\nb")).toEqual({
      start: 1,
      end: 3,
      hasHeading: false,
    });
  });

  it("is null with neither", () => {
    expect(acceptanceRegion("just prose")).toBeNull();
  });

  it("stops at the next heading of the same or a higher level, not a lower one", () => {
    const body = "## Acceptance criteria\n- [ ] a\n### Notes\n- [ ] b\n## Other\n- [ ] c";
    expect(acceptanceRegion(body)).toEqual({ start: 0, end: 4, hasHeading: true });
  });

  it("matches the heading case-insensitively, at any level, with a CR", () => {
    expect(acceptanceRegion("# ACCEPTANCE CRITERIA\r\n- [ ] a\r\n")?.start).toBe(0);
  });

  it("uses the first of two headings", () => {
    const body = "## Acceptance criteria\n- [ ] a\n\n## Acceptance criteria\n- [ ] b";
    expect(acceptanceRegion(body)?.start).toBe(0);
  });
});

describe("descriptionOf", () => {
  it("is the prose above the acceptance section", () => {
    expect(descriptionOf(CARD)).toBe("Description for Alpha.");
  });

  it("is the whole body when there is no section, and empty for a heading-only body", () => {
    expect(descriptionOf("\nJust prose.\n")).toBe("Just prose.");
    expect(descriptionOf(TEMPLATE)).toBe("");
  });

  it("normalises CRLF and keeps internal paragraph breaks", () => {
    expect(descriptionOf("\r\nOne.\r\n\r\nTwo.\r\n\r\n## Acceptance criteria\r\n")).toBe(
      "One.\n\nTwo.",
    );
  });
});

describe("addChecklistItem", () => {
  it("adds exactly one line after the last item and leaves every other byte alone", () => {
    const next = addChecklistItem(CARD, "Third");
    const la = linesOf(CARD);
    const lb = linesOf(next);
    expect(lb.length).toBe(la.length + 1);
    expect(lb[7]).toBe("- [ ] Third");
    expect(lb.slice(0, 7)).toEqual(la);
  });

  it("clones the last item's indentation and marker", () => {
    const body = "## Acceptance criteria\n\n*   [ ] one\n  *   [x] two";
    expect(linesOf(addChecklistItem(body, "three"))[4]).toBe("  *   [ ] three");
  });

  it("keeps a body without a trailing newline without one", () => {
    const next = addChecklistItem(CARD, "Third");
    expect(next.endsWith("\n")).toBe(false);
  });

  it("turns the new-card template into heading, blank, item", () => {
    expect(addChecklistItem(TEMPLATE, "text")).toBe(`\n\n${ACCEPTANCE_HEADING}\n\n- [ ] text\n`);
  });

  it("separates the item from prose that follows the heading", () => {
    const body = "## Acceptance criteria\n\nSome prose.\n";
    expect(addChecklistItem(body, "x")).toBe("## Acceptance criteria\n\n- [ ] x\n\nSome prose.\n");
  });

  it("inserts a blank line when the heading is followed directly by prose", () => {
    const body = "## Acceptance criteria\nSome prose.\n";
    expect(addChecklistItem(body, "x")).toBe("## Acceptance criteria\n\n- [ ] x\n\nSome prose.\n");
  });

  it("appends a new section when there is neither heading nor item", () => {
    const body = "Just a description.";
    const next = addChecklistItem(body, "x");
    expect(next.startsWith(body)).toBe(true);
    expect(next).toBe(`Just a description.\n\n${ACCEPTANCE_HEADING}\n\n- [ ] x\n`);
  });

  it("does not double a blank line the body already ends with", () => {
    expect(addChecklistItem("Desc.\n\n", "x")).toBe(`Desc.\n\n${ACCEPTANCE_HEADING}\n\n- [ ] x\n`);
    expect(addChecklistItem("Desc.\n", "x")).toBe(`Desc.\n\n${ACCEPTANCE_HEADING}\n\n- [ ] x\n`);
  });

  it("starts an empty body with a blank line so the heading is not glued to the frontmatter", () => {
    expect(addChecklistItem("", "x")).toBe(`\n${ACCEPTANCE_HEADING}\n\n- [ ] x\n`);
  });

  it("adds after the last item when items exist without a heading, inventing none", () => {
    const next = addChecklistItem("a\n- [ ] x\nb", "y");
    expect(next).toBe("a\n- [ ] x\n- [ ] y\nb");
  });

  it("uses the first of two headings", () => {
    const body = "## Acceptance criteria\n\n- [ ] a\n\n## Acceptance criteria\n\n- [ ] b\n";
    expect(linesOf(addChecklistItem(body, "c"))[3]).toBe("- [ ] c");
  });

  it("follows CRLF when the body uses it", () => {
    const body = "Desc.\r\n\r\n## Acceptance criteria\r\n\r\n- [ ] a\r\n";
    const next = addChecklistItem(body, "b");
    expect(next).toBe("Desc.\r\n\r\n## Acceptance criteria\r\n\r\n- [ ] a\r\n- [ ] b\r\n");
    expect(addChecklistItem("Desc.\r\n", "x")).toBe(
      `Desc.\r\n\r\n${ACCEPTANCE_HEADING}\r\n\r\n- [ ] x\r\n`,
    );
  });

  it("is a no-op for empty or whitespace text", () => {
    expect(addChecklistItem(CARD, "   ")).toBe(CARD);
    expect(addChecklistItem(CARD, "")).toBe(CARD);
  });

  it("collapses embedded newlines and strips a pasted prefix", () => {
    expect(linesOf(addChecklistItem(CARD, "- [ ] a\nb"))[7]).toBe("- [ ] a b");
  });

  it("round-trips with remove", () => {
    const added = addChecklistItem(CARD, "Third");
    expect(removeChecklistItem(added, 2)).toBe(CARD);
  });
});

describe("replaceChecklistText", () => {
  it("changes only one line's text", () => {
    const next = replaceChecklistText(CARD, 0, "Renamed");
    sameExcept(CARD, next, [5]);
    expect(linesOf(next)[5]).toBe("- [ ] Renamed");
  });

  it("keeps the tick and the marker style", () => {
    expect(replaceChecklistText("*   [x] old", 0, "new")).toBe("*   [x] new");
  });

  it("normalises a missing space after the bracket on that line only", () => {
    expect(replaceChecklistText("- [ ]old\n- [ ]other", 0, "new")).toBe("- [ ] new\n- [ ]other");
  });

  it("preserves CRLF", () => {
    expect(replaceChecklistText("- [ ] a\r\n- [ ] b\r\n", 1, "c")).toBe("- [ ] a\r\n- [ ] c\r\n");
  });

  it("is a no-op for identical text, empty text or a missing index", () => {
    expect(replaceChecklistText(CARD, 0, "First")).toBe(CARD);
    expect(replaceChecklistText(CARD, 0, "  ")).toBe(CARD);
    expect(replaceChecklistText(CARD, 9, "x")).toBe(CARD);
  });
});

describe("removeChecklistItem", () => {
  it("drops exactly one element of the split array", () => {
    const next = removeChecklistItem(CARD, 0);
    expect(linesOf(next)).toEqual(linesOf(CARD).filter((_, i) => i !== 5));
  });

  it("keeps trailing-newline status either way", () => {
    expect(removeChecklistItem("A\n- [ ] x\n", 0)).toBe("A\n");
    expect(removeChecklistItem("A\n- [ ] x", 0)).toBe("A");
  });

  it("keeps the heading when the last item goes", () => {
    expect(removeChecklistItem("## Acceptance criteria\n\n- [ ] only\n", 0)).toBe(
      "## Acceptance criteria\n\n",
    );
  });

  it("leaves other items' ticks alone and ignores a missing index", () => {
    const next = removeChecklistItem(CARD, 0);
    expect(parseChecklist(next)).toEqual([{ index: 0, line: 5, checked: true, text: "Second" }]);
    expect(removeChecklistItem(CARD, 5)).toBe(CARD);
  });

  it("takes the removed line's CR with it", () => {
    expect(removeChecklistItem("- [ ] a\r\n- [ ] b\n", 0)).toBe("- [ ] b\n");
  });
});

describe("moveChecklistItem", () => {
  it("swaps two adjacent items' content", () => {
    const next = moveChecklistItem(CARD, 1, -1);
    sameExcept(CARD, next, [5, 6]);
    expect(parseChecklist(next).map((i) => [i.text, i.checked])).toEqual([
      ["Second", true],
      ["First", false],
    ]);
  });

  it("keeps each position's own line ending on a mixed-ending body", () => {
    const body = "- [ ] a\r\n- [x] b\n";
    expect(moveChecklistItem(body, 0, 1)).toBe("- [x] b\r\n- [ ] a\n");
  });

  it("clamps at the ends and returns the body unchanged for a no-op", () => {
    expect(moveChecklistItem(CARD, 0, -1)).toBe(CARD);
    expect(moveChecklistItem(CARD, 1, 5)).toBe(CARD);
    expect(moveChecklistItem(CARD, 9, 1)).toBe(CARD);
  });

  it("hops over a non-item line without disturbing it", () => {
    const body = "- [ ] a\nnote\n- [ ] b\n- [x] c";
    expect(moveChecklistItem(body, 0, 2)).toBe("- [ ] b\nnote\n- [x] c\n- [ ] a");
  });

  it("carries indentation and marker with the item", () => {
    expect(moveChecklistItem("- [ ] a\n  * [x] b", 1, -1)).toBe("  * [x] b\n- [ ] a");
  });
});

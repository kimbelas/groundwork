import { describe, expect, it } from "vitest";

import { checklistProgress, parseChecklist, toggleChecklistItem } from "@/lib/checklist";

/**
 * Ticking a box rewrites the card body, so the guarantee under test is that exactly one
 * character changes and every other byte survives — indentation, marker style, trailing
 * whitespace and all.
 */

const BODY = `Replace the direct Stripe calls with one billing service.

## Acceptance criteria

- [x] One endpoint returns full billing state
- [ ] Webhook handling is idempotent
*   [ ] No Stripe key reaches the browser
  + [X] Nested item with a plus marker

Some trailing prose, and a line that is - [ ] not at the start.
`;

describe("parseChecklist", () => {
  it("finds every task-list item regardless of marker style", () => {
    const items = parseChecklist(BODY);
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.checked)).toEqual([true, false, false, true]);
    expect(items.map((i) => i.text)).toEqual([
      "One endpoint returns full billing state",
      "Webhook handling is idempotent",
      "No Stripe key reaches the browser",
      "Nested item with a plus marker",
    ]);
  });

  it("indexes items in document order and records their line", () => {
    const items = parseChecklist(BODY);
    expect(items.map((i) => i.index)).toEqual([0, 1, 2, 3]);
    expect(items[0]?.line).toBeLessThan(items[1]?.line ?? 0);
  });

  it("ignores a checkbox that is not at the start of a line", () => {
    expect(parseChecklist("prose - [ ] not an item\n")).toHaveLength(0);
  });

  it("returns nothing for a body with no criteria", () => {
    expect(parseChecklist("Just a description.\n")).toEqual([]);
  });
});

describe("toggleChecklistItem", () => {
  it("changes exactly one character", () => {
    const next = toggleChecklistItem(BODY, 1);
    expect(next).not.toBe(BODY);
    expect(next.length).toBe(BODY.length);

    let diffs = 0;
    for (let i = 0; i < BODY.length; i += 1) if (BODY[i] !== next[i]) diffs += 1;
    expect(diffs).toBe(1);
  });

  it("ticks and un-ticks", () => {
    const ticked = toggleChecklistItem(BODY, 1);
    expect(parseChecklist(ticked)[1]?.checked).toBe(true);

    const back = toggleChecklistItem(ticked, 1);
    expect(parseChecklist(back)[1]?.checked).toBe(false);
    expect(back).toBe(BODY);
  });

  it("preserves marker style and indentation", () => {
    const next = toggleChecklistItem(BODY, 2);
    expect(next).toContain("*   [x] No Stripe key reaches the browser");

    const nested = toggleChecklistItem(BODY, 3);
    expect(nested).toContain("  + [ ] Nested item with a plus marker");
  });

  it("accepts an explicit target state and is idempotent", () => {
    const once = toggleChecklistItem(BODY, 1, true);
    expect(toggleChecklistItem(once, 1, true)).toBe(once);
  });

  it("leaves the body untouched for an index that does not exist", () => {
    expect(toggleChecklistItem(BODY, 99)).toBe(BODY);
    expect(toggleChecklistItem(BODY, -1)).toBe(BODY);
  });

  it("preserves CRLF line endings", () => {
    const crlf = "- [ ] one\r\n- [ ] two\r\n";
    const next = toggleChecklistItem(crlf, 1);
    expect(next).toBe("- [ ] one\r\n- [x] two\r\n");
  });

  it("does not touch other items", () => {
    const next = toggleChecklistItem(BODY, 1);
    const before = parseChecklist(BODY);
    const after = parseChecklist(next);
    expect(after[0]?.checked).toBe(before[0]?.checked);
    expect(after[2]?.checked).toBe(before[2]?.checked);
    expect(after[3]?.checked).toBe(before[3]?.checked);
  });
});

describe("checklistProgress", () => {
  it("counts ticked over total", () => {
    expect(checklistProgress(BODY)).toEqual({ done: 2, total: 4 });
  });

  it("is zero over zero with no criteria", () => {
    expect(checklistProgress("nothing here")).toEqual({ done: 0, total: 0 });
  });
});

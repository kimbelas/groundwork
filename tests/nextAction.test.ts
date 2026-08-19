import { describe, expect, it } from "vitest";

import { progress, relativeTime } from "@/lib/format";
import { nextAction } from "@/lib/nextAction";
import type { ProjectSummary } from "@/lib/vault";
import type { CardMeta } from "@/lib/schema";

/** Test 4 of the five: each of the heuristic's branches, in priority order. */

function card(over: Partial<CardMeta> = {}): CardMeta {
  return {
    id: 1,
    title: "A card",
    column: "Intake",
    phase: null,
    priority: "P2",
    size: "M",
    confidence: 0.5,
    blocked: false,
    order: 100,
    created: "2026-08-01",
    updated: "2026-08-01",
    ...over,
  };
}

function summary(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    meta: {
      name: "Test",
      slug: "test",
      stage: "shaping",
      health: "green",
      archetype: "client",
      columns: ["Intake", "Shaping", "Done"],
      created: "2026-08-01",
      updated: "2026-08-01",
    },
    cards: [],
    phases: [],
    openQuestions: 0,
    briefEmpty: false,
    lastTouchedMs: Date.now(),
    warnings: [],
    ...over,
  };
}

describe("nextAction priority order", () => {
  it("1. a blocked card outranks everything else", () => {
    const action = nextAction(
      summary({
        openQuestions: 3,
        briefEmpty: true,
        cards: [
          card({ id: 1, title: "Fine", column: "Intake" }),
          card({ id: 2, title: "Stuck", blocked: true, column: "Shaping" }),
        ],
      }),
    );
    expect(action.kind).toBe("blocked");
    expect(action.text).toContain("Stuck");
    expect(action.view).toBe("board");
  });

  it("picks the oldest blocked card when there are several", () => {
    const action = nextAction(
      summary({
        cards: [
          card({ id: 5, title: "Newer", blocked: true, created: "2026-08-10" }),
          card({ id: 2, title: "Older", blocked: true, created: "2026-08-02" }),
        ],
      }),
    );
    expect(action.text).toContain("Older");
  });

  it("2. open questions outrank an empty brief and the board", () => {
    const action = nextAction(
      summary({ openQuestions: 2, briefEmpty: true, cards: [card()] }),
    );
    expect(action.kind).toBe("questions");
    expect(action.text).toBe("Answer 2 open questions");
    expect(action.view).toBe("questions");
  });

  it("singularises one question", () => {
    expect(nextAction(summary({ openQuestions: 1 })).text).toBe("Answer 1 open question");
  });

  it("3. an empty brief outranks the board", () => {
    const action = nextAction(summary({ briefEmpty: true, cards: [card()] }));
    expect(action.kind).toBe("brief");
    expect(action.view).toBe("brief");
  });

  it("4. otherwise the highest-priority card in the leftmost workable column", () => {
    const action = nextAction(
      summary({
        cards: [
          card({ id: 1, title: "Later column P1", column: "Shaping", priority: "P1" }),
          card({ id: 2, title: "Leftmost P3", column: "Intake", priority: "P3" }),
          card({ id: 3, title: "Leftmost P1", column: "Intake", priority: "P1" }),
        ],
      }),
    );
    // Column position dominates, then priority within that column.
    expect(action.text).toContain("Leftmost P1");
  });

  it("ignores cards sitting in the final column", () => {
    const action = nextAction(
      summary({ cards: [card({ id: 1, title: "Shipped", column: "Done", priority: "P1" })] }),
    );
    expect(action.kind).toBe("clear");
  });

  it("ignores cards in a column the project does not declare", () => {
    const action = nextAction(
      summary({ cards: [card({ id: 1, title: "Orphan", column: "Nowhere" })] }),
    );
    expect(action.kind).toBe("clear");
  });

  it("treats the last column as done by position, not by name", () => {
    const action = nextAction(
      summary({
        meta: { ...summary().meta, columns: ["Todo", "Shipped"] },
        cards: [card({ id: 1, title: "Out", column: "Shipped" })],
      }),
    );
    expect(action.kind).toBe("clear");
  });
});

describe("progress", () => {
  it("counts the final column as done", () => {
    expect(
      progress(
        summary({
          cards: [
            card({ id: 1, column: "Intake" }),
            card({ id: 2, column: "Done" }),
            card({ id: 3, column: "Done" }),
          ],
        }),
      ),
    ).toEqual({ done: 2, total: 3 });
  });

  it("handles a project with no cards", () => {
    expect(progress(summary())).toEqual({ done: 0, total: 0 });
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 7, 18, 12, 0, 0);

  it("formats each bucket", () => {
    expect(relativeTime(0, now)).toBe("—");
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe("4d ago");
    expect(relativeTime(now - 90 * 86_400_000, now)).toBe("3mo ago");
  });

  it("does not render a negative future time", () => {
    expect(relativeTime(now + 60_000, now)).toBe("just now");
  });
});

import type { ProjectSummary } from "./vault";

/**
 * The dashboard's "next action" — deliberately a heuristic, not an AI call.
 *
 * The dashboard must render instantly and cost nothing. Anything that requires
 * spawning a process to render a list is the wrong design, so this is pure and
 * synchronous over an already-loaded summary.
 *
 * Priority order is documented in docs/01-features.md (G2) and the four branches are
 * each covered by a test.
 */

export type NextActionKind = "brief" | "blocked" | "questions" | "card" | "clear";

export interface NextAction {
  kind: NextActionKind;
  text: string;
  /** Where clicking it should go, relative to the project. */
  view: "brief" | "board" | "questions";
}

export function nextAction(summary: ProjectSummary): NextAction {
  // 1. A blocked card outranks everything — it is the thing actively not moving.
  const blocked = summary.cards
    .filter((c) => c.blocked)
    .sort((a, b) => (a.created ?? "").localeCompare(b.created ?? "") || a.id - b.id)[0];
  if (blocked) {
    return { kind: "blocked", text: `Unblock "${blocked.title}"`, view: "board" };
  }

  // 2. Unanswered questions gate the quality of everything downstream.
  if (summary.openQuestions > 0) {
    const n = summary.openQuestions;
    return {
      kind: "questions",
      text: `Answer ${n} open question${n === 1 ? "" : "s"}`,
      view: "questions",
    };
  }

  // 3. An empty brief means there is nothing to plan from yet.
  if (summary.briefEmpty) {
    return { kind: "brief", text: "Write the brief", view: "brief" };
  }

  // 4. Otherwise: highest priority card in the leftmost column that is not the last one.
  const workable = workableColumns(summary);
  const rank = new Map(workable.map((c, i) => [c, i]));
  const candidates = summary.cards
    .filter((c) => rank.has(c.column))
    .sort(
      (a, b) =>
        (rank.get(a.column) ?? 0) - (rank.get(b.column) ?? 0) ||
        a.priority.localeCompare(b.priority) ||
        a.order - b.order,
    );

  const next = candidates[0];
  if (next) {
    return { kind: "card", text: `Start "${next.title}"`, view: "board" };
  }

  return { kind: "clear", text: "Nothing queued", view: "board" };
}

/**
 * Every column except the final one. The last column is "done" by convention rather
 * than by name, so a project that renames Done to Shipped still behaves correctly.
 */
function workableColumns(summary: ProjectSummary): string[] {
  const cols = summary.meta.columns;
  return cols.length > 1 ? cols.slice(0, -1) : cols;
}

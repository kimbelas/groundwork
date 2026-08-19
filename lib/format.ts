import type { ProjectSummary } from "./vault";

/** Pure presentation helpers. No I/O, no React — so they are trivially testable. */

export interface Progress {
  done: number;
  total: number;
}

/**
 * The last column is "done" by convention rather than by name, so renaming Done to
 * Shipped keeps working.
 */
export function progress(summary: ProjectSummary): Progress {
  const cols = summary.meta.columns;
  const doneColumn = cols.length > 0 ? cols[cols.length - 1] : undefined;
  const total = summary.cards.length;
  if (!doneColumn) return { done: 0, total };
  return { done: summary.cards.filter((c) => c.column === doneColumn).length, total };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "3d ago". Coarse on purpose — an exact timestamp is noise on a dashboard. */
export function relativeTime(ms: number, now: number = Date.now()): string {
  if (!ms) return "—";
  const delta = now - ms;
  if (delta < 0) return "just now";
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return `${Math.floor(delta / (30 * DAY))}mo ago`;
}

export type Tone = "idea" | "active" | "blocked" | "done" | "paused";

export function stageTone(stage: ProjectSummary["meta"]["stage"]): Tone {
  switch (stage) {
    case "idea":
      return "idea";
    case "shaping":
    case "building":
      return "active";
    case "paused":
      return "paused";
    case "shipped":
      return "done";
    case "archived":
      return "paused";
  }
}

export function healthTone(health: ProjectSummary["meta"]["health"]): Tone {
  switch (health) {
    case "green":
      return "done";
    case "amber":
      return "idea";
    case "red":
      return "blocked";
  }
}

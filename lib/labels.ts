import type { CardMeta } from "./schema";

/**
 * Display labels.
 *
 * The vault keeps its compact values — `P1`, `M`, `0.8` — because those are what a
 * person hand-editing a file wants to type and what the schema validates. Only the
 * screen shows words. Changing the stored format instead would break every fixture and
 * every hand-written card for a purely presentational reason.
 */

const PRIORITY: Record<CardMeta["priority"], string> = {
  P1: "High",
  P2: "Medium",
  P3: "Low",
};

const SIZE: Record<CardMeta["size"], string> = {
  S: "Small",
  M: "Medium",
  L: "Large",
};

export function priorityLabel(p: CardMeta["priority"]): string {
  return PRIORITY[p];
}

export function sizeLabel(s: CardMeta["size"]): string {
  return SIZE[s];
}

/**
 * Confidence as a percentage.
 *
 * "80% sure" says what `0.8` means without a legend. It reads as "how well is this
 * understood", which is what the field is for — not a probability of success.
 */
export function confidenceLabel(confidence: number): string {
  const clamped = Math.max(0, Math.min(1, confidence));
  return `${Math.round(clamped * 100)}% sure`;
}

export function progressLabel(done: number, total: number): string {
  if (total === 0) return "No criteria yet";
  if (done === total) return `All ${total} done`;
  return `${done} of ${total} done`;
}

/** 0-100, for the width of a progress bar. Zero total reads as zero, not as NaN. */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.max(0, Math.min(done, total)) / total) * 100);
}

/** Sentence-case a stored lowercase enum for display without touching the value. */
export function sentenceCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

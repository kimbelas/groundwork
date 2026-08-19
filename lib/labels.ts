import type { ARCHETYPES, CardMeta, HEALTHS, LIKELIHOODS, STAGES } from "./schema";

type Stage = (typeof STAGES)[number];
type Health = (typeof HEALTHS)[number];
type Archetype = (typeof ARCHETYPES)[number];
type Likelihood = (typeof LIKELIHOODS)[number];

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

/*
 * The other half of the label layer.
 *
 * Priority and size had words from the start; stage, health, archetype and likelihood
 * never did, so `idea`, `amber`, `saas-mvp` and `med` reached the screen raw — in the
 * dashboard, in every meta dropdown, and in the risk register, where `med` is not even a
 * word. `sentenceCase` was written for exactly this and had no callers at all.
 *
 * Each map is a `Record<Union, string>`, which makes an unlabelled enum member a **compile
 * error** rather than a raw code appearing in the interface. That is stronger than a test:
 * the test below proves it at runtime too, for the case where someone widens a type instead
 * of adding to the enum.
 *
 * Stored values do not change. `project.md` still says `shaping`; the screen says Planning.
 */

const STAGE: Record<Stage, string> = {
  idea: "Idea",
  // "Shaping" is jargon from an earlier vocabulary, and it collides with a board column
  // and a roadmap phase of the same name. Planning is what the stage actually means.
  shaping: "Planning",
  building: "Building",
  paused: "Paused",
  shipped: "Shipped",
  archived: "Archived",
};

const HEALTH: Record<Health, string> = {
  green: "Green",
  amber: "Amber",
  red: "Red",
};

/**
 * Archetypes need a real map, not sentence-casing.
 *
 * `sentenceCase("saas-mvp")` gives "Saas-mvp", which is worse than the raw value — it looks
 * like the app tried and failed. These are product terms with their own capitalisation.
 */
const ARCHETYPE: Record<Archetype, string> = {
  "saas-mvp": "SaaS MVP",
  "internal-tool": "Internal tool",
  client: "Client project",
  "research-spike": "Research spike",
};

const LIKELIHOOD: Record<Likelihood, string> = {
  low: "Low",
  med: "Medium",
  high: "High",
};

export function stageLabel(stage: Stage): string {
  return STAGE[stage];
}

export function healthLabel(health: Health): string {
  return HEALTH[health];
}

export function archetypeLabel(archetype: Archetype): string {
  return ARCHETYPE[archetype];
}

/** Used for both a risk's likelihood and its impact — the same three-point scale. */
export function likelihoodLabel(likelihood: Likelihood): string {
  return LIKELIHOOD[likelihood];
}

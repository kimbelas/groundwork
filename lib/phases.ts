import type { Phase } from "./schema";

/**
 * Which phases exist for a project, as one rule two views can share.
 *
 * The roadmap already worked this out for its lanes: a phase is real if `roadmap.md`
 * declares it **or** if a card references it, because a card assigned to phase 3 when the
 * roadmap declares none would otherwise vanish from the roadmap entirely — present on the
 * board, invisible in the plan. That logic lived inline in `PhaseTrack`, and the card
 * detail pane had its own unrelated idea of the answer: a hard-coded 1 to 8.
 *
 * Hard-coding was wrong in both directions at once. It offered phases that do not exist,
 * and it hid any phase past 8 — so a card sitting in phase 9 showed an empty control, and
 * changing anything else about that card silently rewrote its phase to whatever the select
 * happened to be displaying.
 *
 * Two views deriving the same answer separately is how they come to disagree, so there is
 * one function now and both call it.
 */

/**
 * Every phase number the project actually has, ascending.
 *
 * `current` is included even when nothing else references it, so a card already sitting on
 * a phase can always display its own value. A select whose value matches no option renders
 * blank, which reads as "no phase" while the file says otherwise.
 */
export function phaseNumbers(
  declared: readonly Phase[],
  cards: readonly { phase: number | null }[],
  current: number | null = null,
): number[] {
  const seen = new Set<number>();

  for (const phase of declared) seen.add(phase.n);
  for (const card of cards) if (card.phase !== null) seen.add(card.phase);
  if (current !== null) seen.add(current);

  return [...seen].sort((a, b) => a - b);
}

/**
 * The choices a card's phase control offers.
 *
 * Identical to `phaseNumbers`, except that a project with no phases at all offers phase 1 —
 * otherwise a brand-new project could never assign a first one, and the roadmap view is
 * deliberately read-only so there would be nowhere else to do it.
 *
 * It does **not** offer "one past the end". Extending a plan belongs in `roadmap.md`, where
 * a phase gets a name and a goal; inventing phase 7 from a dropdown produces a lane the
 * roadmap can only label "Phase 7", which is the disagreement this file exists to prevent.
 */
export function phaseChoices(
  declared: readonly Phase[],
  cards: readonly { phase: number | null }[],
  current: number | null = null,
): number[] {
  const numbers = phaseNumbers(declared, cards, current);
  return numbers.length > 0 ? numbers : [1];
}

/**
 * How a phase reads in a control: its number, plus its name where the roadmap gives one.
 *
 * A bare number tells you nothing about what the phase is for. A number a card references
 * but the roadmap never declared has no name to show, so it stays bare rather than being
 * given an invented one — that absence is the signal the roadmap is missing an entry.
 */
export function phaseName(declared: readonly Phase[], n: number): string {
  const match = declared.find((p) => p.n === n);
  return match ? `${n} · ${match.name}` : String(n);
}

import type { Proposal } from "./types";

/**
 * Verify that every claim traces back to something the brief actually says.
 *
 * This is the product's central promise made mechanical. The model must supply either a
 * verbatim quote from the brief or an explicit null meaning "inferred, not stated", and
 * the check is a plain string match — no model is involved, so the check itself cannot
 * hallucinate.
 *
 * What it catches: a confident-sounding card with a quote that does not appear in the
 * brief. What it cannot catch: a real quote stretched to justify an unrelated card.
 * That judgement stays with the human reading the diff, which is the point of the diff.
 */

export type GroundingStatus =
  /** Quoted the brief exactly (allowing for re-wrapped whitespace). */
  | "quoted"
  /** Honestly declared as inferred rather than stated. */
  | "inferred"
  /** Claims a quote that is not in the brief. Shown as a warning in the diff. */
  | "ungrounded";

export interface GroundingResult {
  status: GroundingStatus;
  quote: string | null;
}

/**
 * Collapse every run of whitespace to a single space.
 *
 * A brief is prose that has been hard-wrapped, and a model quoting across a line break
 * will reproduce the words correctly with a newline where the brief has one — or with a
 * space where the brief has a newline. Treating that as a failed quote would mark
 * honest citations "ungrounded" and train the reader to ignore the warning, which is
 * worse than useless. Re-wrapping is not paraphrase; anything beyond it is.
 */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function checkQuote(brief: string, quote: string | null): GroundingResult {
  if (quote === null) return { status: "inferred", quote: null };

  const trimmed = quote.trim();
  if (trimmed.length === 0) return { status: "ungrounded", quote };

  if (brief.includes(trimmed)) return { status: "quoted", quote: trimmed };
  if (normalize(brief).includes(normalize(trimmed))) return { status: "quoted", quote: trimmed };

  return { status: "ungrounded", quote: trimmed };
}

export interface GroundingReport {
  cards: GroundingResult[];
  risks: GroundingResult[];
  assumptions: GroundingResult[];
  /** Total claims whose quote could not be found in the brief. */
  ungrounded: number;
  /** Total claims honestly marked as inferred. */
  inferred: number;
}

export function verifyGrounding(brief: string, proposal: Proposal): GroundingReport {
  const cards = proposal.cards.map((c) => checkQuote(brief, c.groundedIn));
  const risks = proposal.risks.map((r) => checkQuote(brief, r.groundedIn));
  const assumptions = proposal.assumptions.map((a) => checkQuote(brief, a.groundedIn));

  const all = [...cards, ...risks, ...assumptions];
  return {
    cards,
    risks,
    assumptions,
    ungrounded: all.filter((r) => r.status === "ungrounded").length,
    inferred: all.filter((r) => r.status === "inferred").length,
  };
}

/**
 * A vague brief that produced no questions is a failed run, not a clean one — the model
 * smoothed over a gap instead of naming it. Surfaced as a warning above the diff rather
 * than as a hard rejection, because the reader is better placed to judge than a
 * threshold is.
 */
export function proposalWarnings(brief: string, proposal: Proposal): string[] {
  const out: string[] = [];
  const report = verifyGrounding(brief, proposal);

  if (report.ungrounded > 0) {
    out.push(
      `${report.ungrounded} claim${report.ungrounded === 1 ? "" : "s"} quote the brief but the ` +
        `quoted text is not in it. Read those especially closely.`,
    );
  }

  const briefWords = brief.trim().split(/\s+/).filter(Boolean).length;
  if (proposal.job === "synthesize" && briefWords < 120 && proposal.questions.length === 0) {
    out.push(
      "A short brief produced no open questions. Either it was unusually complete, or " +
        "the model filled gaps instead of naming them.",
    );
  }

  /*
   * Counted among CARDS only.
   *
   * `report.inferred` is a vault-wide total across cards, risks and assumptions, and
   * comparing it to `cards.length` fired this warning on a proposal whose every card was
   * properly quoted — the five inferred entries were all risks and assumptions, where
   * null is usually the honest answer. Found on the first real model output, which no
   * fixture would have caught because the fixture's counts never collided.
   */
  const inferredCards = report.cards.filter((r) => r.status === "inferred").length;
  if (proposal.cards.length > 0 && inferredCards === proposal.cards.length) {
    out.push("Every card is marked inferred — nothing here is traceable to the brief.");
  }

  return out;
}

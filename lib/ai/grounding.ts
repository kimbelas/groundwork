import { excerptBodyFor } from "./excerpts";
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

export type CodeGroundingStatus =
  /** The cited excerpt exists and holds the quoted bytes. */
  | "quoted"
  /** Explicitly `null`: about the code, and the excerpts settled nothing. */
  | "inferred"
  /** Cites an excerpt that was never shown, or bytes that are not in the one it names. */
  | "ungrounded"
  /** No citation was made. Most claims concern the plan rather than existing code. */
  | "none";

export interface CodeGroundingResult {
  status: CodeGroundingStatus;
  /** `path:startLine-endLine`, as cited. Null when there was no citation. */
  cite: string | null;
  quote: string | null;
}

/**
 * Verify a code citation against the excerpt file this process wrote.
 *
 * **Against the excerpts, never against the repository.** Re-reading the repo to check a
 * quote would verify a different thing than the one that was asked: the model saw the
 * excerpt bytes, so those are the bytes a citation has to match. It would also mean the
 * check drifts the moment the developer saves a file, marking honest citations false.
 *
 * The quote is matched **inside the cited excerpt**, not anywhere in the file. Quoting file
 * A while citing file B is the exact shape of a plausible wrong answer, and a whole-file
 * match would wave it through.
 */
export function checkCodeQuote(
  excerpts: string | null,
  cite: { path: string; startLine: number; endLine: number; quote: string } | null | undefined,
): CodeGroundingResult {
  if (cite === undefined) return { status: "none", cite: null, quote: null };
  if (cite === null) return { status: "inferred", cite: null, quote: null };

  const heading = `${cite.path}:${cite.startLine}-${cite.endLine}`;
  const result = (status: CodeGroundingStatus): CodeGroundingResult => ({
    status,
    cite: heading,
    quote: cite.quote,
  });

  // A citation with no excerpt file behind it cannot be honest: nothing was shown.
  if (!excerpts) return result("ungrounded");

  /*
   * The excerpt's body, bounded by the fence the writer emitted rather than by the next
   * markdown heading.
   *
   * The heading rule looked right and was wrong: excerpt bodies are arbitrary file content,
   * and the first real repository this met was a README whose own `## ` subheadings cut its
   * excerpt short — so ten citations that were genuinely present came back "ungrounded".
   * `lib/ai/excerpts.ts` owns both halves of the format now, for that reason.
   */
  const section = excerptBodyFor(excerpts, heading);
  if (section === null) return result("ungrounded");

  if (section.includes(cite.quote.trim())) return result("quoted");

  /*
   * Whitespace is collapsed for a second attempt, but case is NOT — deliberately stricter
   * than the prose check above.
   *
   * Prose is hard-wrapped, so a quote crossing a line break legitimately arrives with a
   * space where the brief has a newline; treating that as invention would train the reader
   * to ignore warnings. Code has the same excuse for whitespace, through JSON escaping and
   * re-indentation. It has no excuse for case: `orderFor` and `orderfor` are different
   * symbols, and a citation that gets an identifier's case wrong is quoting from memory.
   */
  const flatten = (s: string) => s.replace(/\s+/g, " ").trim();
  return result(flatten(section).includes(flatten(cite.quote)) ? "quoted" : "ungrounded");
}

export interface CodeGroundingReport {
  cards: CodeGroundingResult[];
  risks: CodeGroundingResult[];
  assumptions: CodeGroundingResult[];
  /** Claims that cite code and check out. */
  quoted: number;
  /** Claims that cite code the excerpts do not support. The number that matters. */
  ungrounded: number;
}

export interface GroundingReport {
  cards: GroundingResult[];
  risks: GroundingResult[];
  assumptions: GroundingResult[];
  /** Total claims whose quote could not be found in the brief. */
  ungrounded: number;
  /** Total claims honestly marked as inferred. */
  inferred: number;
  /** The same check over code citations, counted separately from the brief's. */
  code: CodeGroundingReport;
}

/**
 * `excerpts` is the text of this run's repository excerpts, or null when it had none.
 *
 * Optional so every existing caller keeps working unchanged and gets the honest answer for
 * a run with no code: a citation with no excerpts behind it is ungrounded, which is exactly
 * what it is.
 */
export function verifyGrounding(
  brief: string,
  proposal: Proposal,
  excerpts: string | null = null,
): GroundingReport {
  const cards = proposal.cards.map((c) => checkQuote(brief, c.groundedIn));
  const risks = proposal.risks.map((r) => checkQuote(brief, r.groundedIn));
  const assumptions = proposal.assumptions.map((a) => checkQuote(brief, a.groundedIn));

  const codeCards = proposal.cards.map((c) => checkCodeQuote(excerpts, c.groundedInCode));
  const codeRisks = proposal.risks.map((r) => checkCodeQuote(excerpts, r.groundedInCode));
  const codeAssumptions = proposal.assumptions.map((a) =>
    checkCodeQuote(excerpts, a.groundedInCode),
  );
  const allCode = [...codeCards, ...codeRisks, ...codeAssumptions];

  const all = [...cards, ...risks, ...assumptions];
  return {
    cards,
    risks,
    assumptions,
    ungrounded: all.filter((r) => r.status === "ungrounded").length,
    inferred: all.filter((r) => r.status === "inferred").length,
    code: {
      cards: codeCards,
      risks: codeRisks,
      assumptions: codeAssumptions,
      quoted: allCode.filter((r) => r.status === "quoted").length,
      ungrounded: allCode.filter((r) => r.status === "ungrounded").length,
    },
  };
}

/**
 * A vague brief that produced no questions is a failed run, not a clean one — the model
 * smoothed over a gap instead of naming it. Surfaced as a warning above the diff rather
 * than as a hard rejection, because the reader is better placed to judge than a
 * threshold is.
 */
export function proposalWarnings(
  brief: string,
  proposal: Proposal,
  excerpts: string | null = null,
): string[] {
  const out: string[] = [];
  const report = verifyGrounding(brief, proposal, excerpts);

  if (report.ungrounded > 0) {
    out.push(
      `${report.ungrounded} claim${report.ungrounded === 1 ? "" : "s"} quote the brief but the ` +
        `quoted text is not in it. Read those especially closely.`,
    );
  }

  /*
   * Kept as its own sentence rather than folded into the count above.
   *
   * A quote the brief does not contain and a citation the code does not contain fail
   * differently and are read differently: the first is a claim about what the user asked
   * for, the second a claim about what their code already does. A reader who acts on a
   * wrong code citation goes and edits the wrong file.
   */
  if (report.code.ungrounded > 0) {
    const n = report.code.ungrounded;
    out.push(
      `${n} claim${n === 1 ? "" : "s"} cite the repository, but the quoted code is not in the ` +
        `excerpts this run was given. Treat ${n === 1 ? "it" : "them"} as unverified.`,
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

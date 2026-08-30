import { z } from "zod";

import { LIKELIHOODS, PRIORITIES, SIZES } from "@/lib/schema";

/**
 * The contract between an AI run and the app.
 *
 * A run never writes into `vault/`. It writes one JSON document matching the schema
 * below, and the app validates it, shows it as a diff, and applies only what the user
 * accepts. Everything here is therefore a *proposal* — nothing in this file describes
 * state, only something being suggested.
 */

export type AiJobKind = "synthesize" | "enhance-card" | "critique" | "suggest-answers";

export type AiJob =
  | { kind: "synthesize"; slug: string }
  | { kind: "enhance-card"; slug: string; cardId: number }
  | { kind: "critique"; slug: string }
  | { kind: "suggest-answers"; slug: string };

export type AiEvent =
  | { type: "step"; label: string }
  | { type: "done"; runId: string }
  | { type: "error"; message: string };

// ---------------------------------------------------------------- schema

/**
 * `groundedIn` is the anti-invention mechanism: a verbatim quote from the brief, or an
 * explicit null meaning "inferred, not stated". Requiring the model to choose is what
 * makes template filler visible — filler has nothing to quote.
 */
const Grounded = z.string().min(1).max(600).nullable();

/**
 * The same mechanism for a claim about existing code: where it is, and the bytes that say so.
 *
 * Structured rather than one `"path:12-40 — quote"` string because both halves are checked,
 * separately: the citation has to name an excerpt the app actually put in front of the model,
 * and the quote has to appear in it. Field names match `CodeChunk` — `path`, `startLine`,
 * `endLine` — so a citation and the chunk it came from read the same way.
 *
 * **Optional, and `.default()` is deliberately absent.** Absent means "this run had no code
 * to cite"; `null` means "inferred, not read". A default would consume `undefined` and turn
 * every uncited claim into a positive assertion about the code — the bug CLAUDE.md records
 * from `lib/ai/apply.ts`, in the one place where it would fabricate a citation.
 */
export const GroundedInCodeSchema = z
  .object({
    /** Repo-relative, forward slashes — exactly as the excerpt heading spells it. */
    path: z.string().min(1).max(400),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    /**
     * Verbatim from the excerpt. Checked by string match, so a paraphrase is a warning.
     *
     * `.min(1)` accepts a single space, and `"".includes(x)` is true for every x — so a
     * citation quoting `" "` verified against any excerpt that existed. Content, not length.
     */
    quote: z
      .string()
      .max(600)
      .refine((q) => q.trim().length > 0, { message: "a quote cannot be blank" }),
  })
  .refine((c) => c.endLine >= c.startLine, {
    message: "a citation cannot end before it starts",
    path: ["endLine"],
  });

const GroundedInCode = GroundedInCodeSchema.nullable().optional();

export const CardProposalSchema = z
  .object({
    // No `delete`. The user's work is not the model's to remove.
    op: z.enum(["create", "update"]),
    /** Required for `update`; forbidden for `create` — the vault assigns ids. */
    id: z.number().int().positive().optional(),
    /**
     * Required to create a card; optional to update one.
     *
     * An update is a patch, and a patch that must restate every field it is not changing is
     * not a patch. Requiring this unconditionally cost a whole eleven-minute run: five of the
     * thirteen cards were updates that changed a body and an acceptance list and correctly
     * left the title alone, and the document was refused for it.
     *
     * That is the third schema in this file to discard a good run by being strict about
     * something that did not need to be. The rule that came out of it: fail loudly on what
     * would be WRONG - an invented citation, an update with no id - and never on what is
     * merely absent or long.
     */
    title: z.string().min(1).max(200).optional(),
    column: z.string().min(1).max(60).optional(),
    phase: z.number().int().positive().nullable().optional(),
    priority: z.enum(PRIORITIES),
    size: z.enum(SIZES),
    confidence: z.number().min(0).max(1),
    body: z.string().max(20_000),
    acceptance: z.array(z.string().min(1).max(400)).max(24),
    groundedIn: Grounded,
    groundedInCode: GroundedInCode,
  })
  .refine((c) => c.op !== "update" || typeof c.id === "number", {
    message: "an update must name the card id it updates",
    path: ["id"],
  })
  .refine((c) => c.op !== "create" || c.id === undefined, {
    message: "a create must not choose its own id; the vault assigns them",
    path: ["id"],
  })
  .refine((c) => c.op !== "create" || typeof c.title === "string", {
    // A new card with no title is a card nobody can find. An update without one is a patch.
    message: "a create must have a title",
    path: ["title"],
  });

export const PhaseProposalSchema = z.object({
  n: z.number().int().positive().max(99),
  name: z.string().min(1).max(80),
  goal: z.string().max(400).default(""),
});

/**
 * A likelihood, spelled the way a model actually spells it.
 *
 * `med` is an abbreviation, and the prompt could only show it by example — so a real run
 * wrote `"medium"` and **the entire proposal was rejected**: six cards and six questions
 * thrown away over two words in the risk register. The prompts now state the allowed values
 * outright, which is the real fix; this is the belt to that braces.
 *
 * Normalising a synonym is not the same as coercing content. The app refuses to repair a
 * malformed *document* — a partial apply is worse than a failed run — but `medium` and `med`
 * are the same answer in different words, and there is no reading of `medium` that means
 * something else. Case is folded for the same reason: `High` is not a different likelihood.
 *
 * Anything not on this list passes through untouched, so zod still reports what was wrong
 * rather than this quietly inventing a value. Non-strings pass through too: a preprocess
 * that turned `undefined` into a default would be the bug CLAUDE.md warns about.
 */
const LIKELIHOOD_SYNONYMS: Record<string, string> = {
  medium: "med",
  moderate: "med",
  low: "low",
  med: "med",
  high: "high",
};

const Likelihood = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  return LIKELIHOOD_SYNONYMS[v.trim().toLowerCase()] ?? v;
}, z.enum(LIKELIHOODS));

export const RiskProposalSchema = z.object({
  text: z.string().min(1).max(600),
  likelihood: Likelihood,
  impact: Likelihood,
  mitigation: z.string().max(600).default(""),
  groundedIn: Grounded,
  groundedInCode: GroundedInCode,
});

export const AssumptionProposalSchema = z.object({
  text: z.string().min(1).max(600),
  groundedIn: Grounded,
  groundedInCode: GroundedInCode,
});

export const QuestionProposalSchema = z.object({
  text: z.string().min(1).max(600),
  /** What this question is blocking — shown next to it in the diff. */
  blocks: z.string().max(300).default(""),
});

export const ProposalSchema = z.object({
  runId: z.string().min(1).max(64),
  job: z.enum(["synthesize", "enhance-card", "critique"]),
  slug: z.string().min(1).max(64),
  summary: z.string().min(1).max(2000),
  phases: z.array(PhaseProposalSchema).max(20).default([]),
  cards: z.array(CardProposalSchema).max(80).default([]),
  risks: z.array(RiskProposalSchema).max(40).default([]),
  assumptions: z.array(AssumptionProposalSchema).max(40).default([]),
  questions: z.array(QuestionProposalSchema).max(40).default([]),
});

export type Proposal = z.output<typeof ProposalSchema>;
export type CardProposal = z.output<typeof CardProposalSchema>;
export type PhaseProposal = z.output<typeof PhaseProposalSchema>;
export type RiskProposal = z.output<typeof RiskProposalSchema>;
export type AssumptionProposal = z.output<typeof AssumptionProposalSchema>;
export type QuestionProposal = z.output<typeof QuestionProposalSchema>;
export type GroundedInCode = z.output<typeof GroundedInCodeSchema>;

// ---------------------------------------------------------------- run records

export type RunStatus = "running" | "ready" | "failed" | "stopped";

/**
 * What the repository contributed to a run, recorded so the answer survives the run.
 *
 * Stored rather than recomputed because it is a fact about what happened, not about what
 * would happen now: an index rebuilt tomorrow would give a different answer to "was this
 * plan grounded in the code", and the honest answer is the one from the time.
 *
 * The status is a code and the reason is prose. Both, deliberately — the code is what a
 * test or a later filter can rely on, and the sentence is what a person needs, because
 * "no-index" on its own does not say what to do about it.
 */
export interface RunRepoContext {
  status: "no-repo" | "no-index" | "stale-index" | "no-hits" | "included" | "unavailable";
  /** How many excerpts the run was given. Zero unless status is "included". */
  excerpts: number;
  /** Whether semantic ranking took part, as opposed to keyword matching alone. */
  semantic: boolean;
  reason?: string;
}

export const RunRepoContextSchema = z.object({
  status: z.enum(["no-repo", "no-index", "stale-index", "no-hits", "included", "unavailable"]),
  excerpts: z.number().int().min(0),
  semantic: z.boolean(),
  reason: z.string().optional(),
});

export interface RunRecord {
  runId: string;
  slug: string;
  job: AiJobKind;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Present when status is "failed". */
  error?: string;
  /** Set once the proposal has been applied, so revert knows what it is undoing. */
  appliedAt?: string;
  /** Absent on runs that predate repo grounding, which is why it is optional. */
  repoContext?: RunRepoContext;
  /**
   * The card an `enhance-card` run was for. Without it a finished enhancement could not be
   * found again from the card that asked for it — the drawer had to run the model twice.
   * Absent on other jobs and on records that predate it.
   */
  cardId?: number;
}

export const RunRecordSchema = z.object({
  runId: z.string().min(1).max(64),
  slug: z.string().min(1).max(64),
  job: z.enum(["synthesize", "enhance-card", "critique", "suggest-answers"]),
  status: z.enum(["running", "ready", "failed", "stopped"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().optional(),
  appliedAt: z.string().optional(),
  repoContext: RunRepoContextSchema.optional(),
  // In the schema, not only the type: `updateRun` is read-merge-write through this parser,
  // and an unknown key is stripped - the id would vanish on the first status update.
  cardId: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------- suggested answers

/**
 * One candidate answer to an open question.
 *
 * `groundedIn` carries the same weight it does everywhere else in this file: a verbatim
 * quote from the brief, or an explicit `null` meaning the answer is a reasonable inference
 * rather than something the project has already said. That distinction matters more here
 * than anywhere: an option the user is about to click and store as a *confirmed fact* must
 * not look better sourced than it is.
 */

/**
 * The first sentence, and no more than `max` characters of it.
 *
 * Used as a `.transform()` rather than a `.max()`, and the difference is the whole lesson:
 * a length limit that REJECTS throws away an entire run because one option ran long. That
 * happened - the caps went in, and output written minutes earlier under the old limits was
 * refused wholesale with a wall of zod complaints where the answers had been. It is the same
 * shape as a single absent `groundedIn` invalidating a proposal of sixteen cards.
 *
 * Length is not like grounding. A missing citation is a correctness problem and has to fail
 * loudly; a long sentence is a presentation problem, and the honest response is to show less
 * of it. So this shortens and the document stays valid.
 *
 * The ellipsis is load-bearing: the shortened text is what a click puts in the answer box,
 * and a silently clipped sentence would be stored as though the model had written it.
 */
export function oneSentence(text: string, max: number): string {
  const trimmed = text.trim();

  // A sentence ends at a full stop followed by a space or the end of the string. `?` and `!`
  // count too - a question restated as an option is bad writing, not a parse failure.
  const end = /[.?!](\s|$)/.exec(trimmed);
  const first = end ? trimmed.slice(0, end.index + 1) : trimmed;
  if (first.length <= max) return first;

  // Cut on a word boundary so the ellipsis does not land mid-word.
  const cut = first.slice(0, max - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

const shortened = (max: number) =>
  z
    .string()
    /* A generous ceiling is still a ceiling: this is a sanity bound on a document read off
       disk, not the display limit. The transform below is what makes it one sentence. */
    .max(4000)
    .transform((v) => oneSentence(v, max));

export const AnswerOptionSchema = z.object({
  /*
   * One sentence, and the cap is what makes it one.
   *
   * The first version allowed 600 characters and got them: three options of four lines each,
   * stacked under a question and above the box you answer in - a wall to read before you can
   * say anything. A limit the model can feel is the instruction it actually follows, so the
   * prompt asks for one sentence and this refuses a paragraph.
   */
  text: z.string().min(1).max(4000).transform((v) => oneSentence(v, 200)),
  /** The trade-off, in a clause. Shown under the option; never stored as the answer. */
  because: shortened(140).default(""),
  /**
   * The one the model would pick. Exactly one per question, and `false` when it will not
   * choose - defaulting to `true` would make every option look endorsed, which reads the
   * same as none of them being.
   */
  recommended: z.boolean().default(false),
  groundedIn: Grounded,
  groundedInCode: GroundedInCode,
});

export const QuestionSuggestionSchema = z.object({
  /** The `id` from questions.md — `q3`, not the question's text. */
  questionId: z.string().min(1).max(64),
  /*
   * Three is what the prompt asks for; one is what the schema tolerates.
   *
   * A hard `.min(3)` would throw away an entire run because the model could only think of
   * two honest answers to one question out of ten — the exact failure already seen when a
   * single absent `groundedIn` invalidated a proposal of sixteen cards. Fewer options is a
   * visible, harmless shortfall; a discarded run is not.
   */
  options: z.array(AnswerOptionSchema).min(1).max(3),
});

export const SuggestionsSchema = z.object({
  runId: z.string().min(1),
  job: z.literal("suggest-answers"),
  slug: z.string().min(1).max(64),
  /* One sentence. At 2000 characters this rendered as an eight-line essay above the first
     question, which is the opposite of an overview. */
  summary: shortened(240).default(""),
  questions: z.array(QuestionSuggestionSchema).max(60),
});

export type AnswerOption = z.output<typeof AnswerOptionSchema>;
export type QuestionSuggestion = z.output<typeof QuestionSuggestionSchema>;
export type Suggestions = z.output<typeof SuggestionsSchema>;

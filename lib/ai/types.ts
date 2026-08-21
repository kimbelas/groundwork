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

export type AiJobKind = "synthesize" | "enhance-card" | "critique";

export type AiJob =
  | { kind: "synthesize"; slug: string }
  | { kind: "enhance-card"; slug: string; cardId: number }
  | { kind: "critique"; slug: string };

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
    /** Verbatim from the excerpt. Checked by string match, so a paraphrase is a warning. */
    quote: z.string().min(1).max(600),
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
    title: z.string().min(1).max(200),
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
}

export const RunRecordSchema = z.object({
  runId: z.string().min(1).max(64),
  slug: z.string().min(1).max(64),
  job: z.enum(["synthesize", "enhance-card", "critique"]),
  status: z.enum(["running", "ready", "failed", "stopped"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().optional(),
  appliedAt: z.string().optional(),
  repoContext: RunRepoContextSchema.optional(),
});

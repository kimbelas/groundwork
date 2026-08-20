import { z } from "zod";

/**
 * Frontmatter schemas.
 *
 * Everything here is permissive on input and strict on output: defaults fill gaps so a
 * hand-written file with three keys still loads, while the parsed value is fully typed.
 * The vault is meant to be editable by hand, so a missing `size:` must not 500 the app.
 */

/** YAML parses bare `2026-08-18` into a Date; normalise both spellings to `YYYY-MM-DD`. */
const IsoDate = z
  .union([z.string(), z.date()])
  .transform((v) => (typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10)));

export const STAGES = ["idea", "shaping", "building", "paused", "shipped", "archived"] as const;
export const HEALTHS = ["green", "amber", "red"] as const;
export const ARCHETYPES = ["saas-mvp", "internal-tool", "client", "research-spike"] as const;
export const PRIORITIES = ["P1", "P2", "P3"] as const;
export const SIZES = ["S", "M", "L"] as const;
export const LIKELIHOODS = ["low", "med", "high"] as const;

/**
 * The columns a new project starts with.
 *
 * Ordinary words, deliberately. The previous set - Intake, Shaping, Build, Review, Done -
 * was vocabulary this project invented, and two of those names collided with other axes:
 * "Shaping" was simultaneously a column, a project stage and a roadmap phase name, so the
 * same word meant three unrelated things depending on where it appeared.
 *
 * This is only a DEFAULT. Columns are per-project data in project.md frontmatter, so an
 * existing project keeps whatever it has, and nothing in the app may assume these names -
 * the e2e fixtures deliberately use other ones, which is what proves it.
 */
export const DEFAULT_COLUMNS = [
  "Backlog",
  "To do",
  "In progress",
  "In review",
  "Done",
] as const;

export const StageSchema = z.enum(STAGES);
export const HealthSchema = z.enum(HEALTHS);
export const ArchetypeSchema = z.enum(ARCHETYPES);
export const PrioritySchema = z.enum(PRIORITIES);
export const SizeSchema = z.enum(SIZES);
export const LikelihoodSchema = z.enum(LIKELIHOODS);

export const ProjectMetaSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  stage: StageSchema.default("idea"),
  health: HealthSchema.default("green"),
  archetype: ArchetypeSchema.default("internal-tool"),
  columns: z.array(z.string().min(1)).min(1).default([...DEFAULT_COLUMNS]),
  /**
   * Absolute path to the connected repository, or absent.
   *
   * A repo is a property of a project, not an entity of its own: one optional
   * frontmatter field, hand-editable like everything else in the vault. It is stored
   * absolute because the vault and the repo are unrelated trees on disk and there is no
   * meaningful base to be relative to.
   *
   * Only the shape is checked here. Whether the path exists, is a directory, and sits
   * outside the vault is decided by `lib/repo.ts`, because those are questions about the
   * filesystem and this module is pure. A path that was valid when connected can stop
   * being valid at any time — the drive is unplugged, the directory is renamed — so the
   * schema must keep parsing a stale value rather than making the project unreadable.
   */
  /*
   * Tolerant on the way in, clean on the way out.
   *
   * `z.string().min(1).optional()` looked right and made the promise above a lie: a bare
   * `repo:` line - the obvious hand-edit for "disconnect this" - parses as `null`, failed
   * validation, and `getProject` threw. That takes down the whole brief page, so the one
   * thing a person is most likely to type turned a stale setting into a dead screen.
   *
   * `preprocess` rather than `transform`, so the key stays optional in the output type:
   * a transform on an optional field makes it a required `string | undefined`, which
   * forces every literal ProjectMeta in the codebase to spell out `repo`.
   *
   * Anything that is not a usable path reads as absent. `stripUndefined` drops it on
   * serialization, so the key does not come back on the next write either.
   */
  repo: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().min(1).optional(),
  ),
  created: IsoDate.optional(),
  updated: IsoDate.optional(),
});
export type ProjectMeta = z.output<typeof ProjectMetaSchema>;

export const CardMetaSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  column: z.string().min(1),
  phase: z.number().int().positive().nullable().default(null),
  priority: PrioritySchema.default("P2"),
  size: SizeSchema.default("M"),
  confidence: z.number().min(0).max(1).default(0.5),
  blocked: z.boolean().default(false),
  order: z.number().default(100),
  created: IsoDate.optional(),
  updated: IsoDate.optional(),
});
export type CardMeta = z.output<typeof CardMetaSchema>;

export const PhaseSchema = z.object({
  n: z.number().int().positive(),
  name: z.string().min(1),
  goal: z.string().default(""),
});
export type Phase = z.output<typeof PhaseSchema>;

export const RoadmapSchema = z.object({
  phases: z.array(PhaseSchema).default([]),
});

export const QuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  status: z.enum(["open", "answered"]).default("open"),
  answer: z.string().nullable().default(null),
  fromRun: z.string().nullable().default(null),
  created: IsoDate.optional(),
});
export type Question = z.output<typeof QuestionSchema>;

export const QuestionsSchema = z.object({
  questions: z.array(QuestionSchema).default([]),
});

export const RiskSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  likelihood: LikelihoodSchema.default("med"),
  impact: LikelihoodSchema.default("med"),
  mitigation: z.string().default(""),
});
export type Risk = z.output<typeof RiskSchema>;

export const AssumptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  validated: z.boolean().default(false),
});
export type Assumption = z.output<typeof AssumptionSchema>;

export const RisksSchema = z.object({
  risks: z.array(RiskSchema).default([]),
  assumptions: z.array(AssumptionSchema).default([]),
});

/** Compact one-line reason a document failed to parse, for showing in the UI. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

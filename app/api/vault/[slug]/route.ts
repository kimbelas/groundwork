import { z } from "zod";

import { VaultError } from "@/lib/errors";
import { readJson, route } from "@/lib/http";
import { validateRepoPath } from "@/lib/repo";
import { readLock, readRun } from "@/lib/runs";
import { ARCHETYPES, HEALTHS, STAGES } from "@/lib/schema";
import {
  getProject,
  patchProjectMeta,
  renameColumn,
  setColumns,
  trashProject,
  vaultRoot,
  writeBrief,
} from "@/lib/vault";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ slug: string }>;
}

/**
 * `expectedMtimeMs` is required on every write, not optional.
 *
 * Making it optional would leave a silent last-writer-wins path open for any caller
 * that forgot it — which is exactly the bug the precondition exists to prevent. A
 * client that genuinely has no baseline must GET first.
 */
const BriefPatch = z.object({
  kind: z.literal("brief"),
  body: z.string(),
  expectedMtimeMs: z.number().finite(),
});

const MetaPatch = z.object({
  kind: z.literal("meta"),
  expectedMtimeMs: z.number().finite(),
  patch: z
    .object({
      name: z.string().min(1).max(200).optional(),
      stage: z.enum(STAGES).optional(),
      health: z.enum(HEALTHS).optional(),
      archetype: z.enum(ARCHETYPES).optional(),
      columns: z.array(z.string().min(1).max(60)).min(1).max(12).optional(),
      /**
       * Connect a repository, or `null` to disconnect.
       *
       * `nullable` rather than a second patch kind, because connecting is an edit to one
       * frontmatter field and shares the precondition with every other edit to that file.
       * Only the length is checked here — whether the directory exists and sits outside
       * the vault is a filesystem question, answered by `validateRepoPath` below, and a
       * zod refinement that hit the disk would make this schema untestable in isolation.
       */
      repo: z.string().min(1).max(4096).nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "Patch must change at least one field"),
});

const ColumnsPatch = z.object({
  kind: z.literal("columns"),
  columns: z.array(z.string().min(1).max(60)).min(1).max(12),
  expectedMtimeMs: z.number().finite(),
});

const RenameColumnPatch = z.object({
  kind: z.literal("rename-column"),
  from: z.string().min(1).max(60),
  to: z.string().min(1).max(60),
  // Required, not optional. An optional precondition is a last-writer-wins clobber
  // waiting to happen, which is the rule every other mutating patch here already follows.
  expectedMtimeMs: z.number().finite(),
});

const Patch = z.discriminatedUnion("kind", [
  BriefPatch,
  MetaPatch,
  ColumnsPatch,
  RenameColumnPatch,
]);

export const GET = route<Ctx>(async (_req, { params }) => {
  const { slug } = await params;
  const project = await getProject(slug);
  return Response.json(project);
});

export const PATCH = route<Ctx>(
  async (req, { params }) => {
    const { slug } = await params;
    const input = await readJson(req, Patch);

    if (input.kind === "brief") {
      const { mtimeMs } = await writeBrief(slug, input.body, input.expectedMtimeMs);
      return Response.json({ mtimeMs });
    }

    if (input.kind === "columns") {
      return Response.json(await setColumns(slug, input.columns, input.expectedMtimeMs));
    }

    if (input.kind === "rename-column") {
      // The precondition guards project.md, where the column list lives. Each card is
      // re-read immediately before it is rewritten, so the sweep needs no mtime of its own.
      const moved = await renameColumn(slug, input.from, input.to, input.expectedMtimeMs);
      return Response.json({ moved });
    }

    /*
     * Canonicalise the repo path before it is stored, and refuse it if it is unusable.
     *
     * This happens here rather than in `lib/vault.ts` because it is the one field whose
     * validity depends on a tree the vault layer knows nothing about. Storing the
     * resolved real path — not the string the user typed — is what lets a later
     * containment check compare like with like: a symlink can be repointed after the
     * fact, and a path that was inside the repo when it was saved would then not be.
     *
     * `null` is passed straight through to mean disconnect. It is deliberately not
     * validated: a repo that has been deleted must still be removable.
     */
    let patch = input.patch;
    if (typeof patch.repo === "string") {
      const info = await validateRepoPath(patch.repo, vaultRoot());
      patch = { ...patch, repo: info.path };
    }

    const { mtimeMs, meta } = await patchProjectMeta(slug, patch, input.expectedMtimeMs);
    return Response.json({ mtimeMs, meta });
  },
  { mutating: true },
);

/**
 * Required, like every other precondition on this route.
 *
 * A delete is a write - the last one this file gets - so it carries the same baseline the
 * brief editor and the meta bar carry. What it protects is not the bytes, which are about
 * to move wholesale, but the confirmation: the dialog named a project, and if that project
 * changed after the page was loaded then what the user agreed to is not what is on disk.
 */
const DeleteBody = z.object({
  expectedMtimeMs: z.number().finite(),
});

/**
 * Move the project to `vault/.trash/`.
 *
 * `DELETE` with a body, matching `/api/cards` - the precondition has to travel somehow and
 * a query string is the wrong place for one, being the part of a request that gets logged,
 * cached and pasted into chat.
 */
export const DELETE = route<Ctx>(
  async (req, { params }) => {
    const { slug } = await params;
    const input = await readJson(req, DeleteBody);

    /*
     * Refuse while an AI run owns this project.
     *
     * The run holds no handle on `vault/` - it writes a proposal into its own run directory
     * and never touches the vault, which is the whole point of that design - so this is not
     * about file locking. It is about the run finishing against a project that is no longer
     * there: the apply would land on a missing directory, and the review the user is about
     * to be shown would describe a plan for something deleted underneath it.
     *
     * The lock records only a run id, so the run itself is read to learn whose it is. A run
     * on a *different* project is none of this route's business.
     */
    const lock = readLock();
    if (lock) {
      const run = await readRun(lock.runId);
      if (run?.slug === slug) {
        throw new VaultError(
          "conflict",
          "An AI run is working on this project. Wait for it to finish before deleting.",
        );
      }
    }

    const { trashedTo } = await trashProject(slug, input.expectedMtimeMs);
    return Response.json({ trashedTo });
  },
  { mutating: true },
);

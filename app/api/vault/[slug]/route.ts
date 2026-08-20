import { z } from "zod";

import { readJson, route } from "@/lib/http";
import { ARCHETYPES, HEALTHS, STAGES } from "@/lib/schema";
import { getProject, patchProjectMeta, renameColumn, setColumns, writeBrief } from "@/lib/vault";

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

    const { mtimeMs, meta } = await patchProjectMeta(slug, input.patch, input.expectedMtimeMs);
    return Response.json({ mtimeMs, meta });
  },
  { mutating: true },
);

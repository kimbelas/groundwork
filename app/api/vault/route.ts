import { z } from "zod";

import { readJson, route } from "@/lib/http";
import { ARCHETYPES } from "@/lib/schema";
import { createProject, listProjects } from "@/lib/vault";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  /** Optional: derived from the name when absent. Immutable once created. */
  slug: z.string().min(1).max(64).optional(),
  archetype: z.enum(ARCHETYPES),
});

export const GET = route(async () => {
  const entries = await listProjects();
  return Response.json({
    projects: entries.map((e) =>
      e.ok
        ? { slug: e.slug, name: e.summary.meta.name, stage: e.summary.meta.stage, ok: true }
        : { slug: e.slug, ok: false, error: e.error },
    ),
  });
});

/**
 * Create a project.
 *
 * The vault layer owns slug derivation and validation, and refuses to overwrite an
 * existing folder — so a duplicate name surfaces as a 409 rather than silently merging
 * into someone else's project.
 */
export const POST = route(
  async (req) => {
    const input = await readJson(req, CreateBody);

    const meta = await createProject({
      name: input.name,
      ...(input.slug ? { slug: input.slug } : {}),
      archetype: input.archetype,
    });

    return Response.json(meta, { status: 201 });
  },
  { mutating: true },
);

import { z } from "zod";

import { VaultError } from "@/lib/errors";
import { readJson, route } from "@/lib/http";
import { validateRepoPath } from "@/lib/repo";
import { ARCHETYPES } from "@/lib/schema";
import { nameFromFolder } from "@/lib/slug";
import { createProject, listProjects, vaultRoot } from "@/lib/vault";

export const dynamic = "force-dynamic";

/**
 * A project needs a name or a repository, and can be given both.
 *
 * `name` stopped being required when connecting a repository became a way to start: the
 * folder already has a name, and retyping it as prose is the step this is here to remove.
 * The refinement is what keeps "neither" from reaching `createProject`, where the failure
 * would be a slug derived from an empty string.
 */
const CreateBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    /** Optional: derived from the name, or from the repository folder. Immutable once created. */
    slug: z.string().min(1).max(64).optional(),
    /** Optional: `createProject` owns the default, so there is one of it rather than two. */
    archetype: z.enum(ARCHETYPES).optional(),
    /** An absolute path. Validated against the filesystem below, not by this schema. */
    repo: z.string().min(1).max(4096).optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.repo !== undefined,
    "Give a name, a repository, or both",
  );

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

    /*
     * The repository is validated BEFORE the project is created, and the order is the
     * point. Creating first would leave a real folder in the vault every time someone
     * pastes a path with a typo in it - a project that exists, is empty, and was never
     * asked for. Validation is also what canonicalises the path, so the name below is
     * derived from the directory that is really there rather than the string typed.
     */
    let repo: string | undefined;
    let fromFolder: string | undefined;
    if (input.repo !== undefined) {
      const info = await validateRepoPath(input.repo, vaultRoot());
      repo = info.path;
      fromFolder = nameFromFolder(info.name);
    }

    const name = input.name?.trim() || fromFolder;
    if (!name) {
      // Reachable only from a repository whose folder name is entirely separators.
      throw new VaultError(
        "invalid_document",
        "That folder's name produced nothing usable. Give the project a name.",
      );
    }

    const meta = await createProject({
      name,
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.archetype ? { archetype: input.archetype } : {}),
      ...(repo ? { repo } : {}),
    });

    return Response.json(meta, { status: 201 });
  },
  { mutating: true },
);

import { z } from "zod";

import { buildIndex, previewBuild } from "@/lib/index/build";
import { search } from "@/lib/index/retrieve";
import { deleteIndex, readIndex, summarizeIndex } from "@/lib/index/store";
import { readJson, route } from "@/lib/http";
import { validateRepoPath } from "@/lib/repo";
import { getProject, vaultRoot } from "@/lib/vault";
import { VaultError } from "@/lib/errors";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ slug: string }>;
}

/**
 * Building and querying the repo index.
 *
 * The index is derived data in `.groundwork/index/`, disposable and rebuildable — so this
 * whole route is a cache-management surface, not a data API. Nothing here is the source of
 * truth for anything, which is why DELETE is safe and unconditional.
 */

/**
 * Re-validate the stored repo path on every request.
 *
 * `repo` is hand-editable frontmatter. The checks that ran when it was connected — exists,
 * is a directory, is not nested with the vault — say nothing about what is in the file now,
 * and `lib/repo.ts` deliberately cannot check the vault relationship on its own. So the
 * value gets validated here, where the vault root is known, before any reader sees it.
 */
async function repoFor(slug: string): Promise<string> {
  const project = await getProject(slug);
  if (!project.meta.repo) {
    throw new VaultError(
      "not_found",
      `${slug} has no repository connected. Connect one before indexing.`,
    );
  }
  return (await validateRepoPath(project.meta.repo, vaultRoot())).path;
}

/**
 * Status, and what a build would cost.
 *
 * `?preview=1` reads and hashes every indexable file, so it is not free — it is the answer
 * to "how long will this take", which has to be honest to be worth anything. Plain GET
 * reads only the manifest and is cheap enough for a page render.
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const { slug } = await params;
  const url = new URL(req.url);

  const q = url.searchParams.get("q");
  if (q !== null) {
    const index = await readIndex(slug);
    if (!index) return Response.json({ hits: [], semantic: false, built: false });

    const limit = Number(url.searchParams.get("limit") ?? 10);
    const result = await search(index, q, {
      limit: Number.isFinite(limit) ? Math.min(Math.max(1, limit), 50) : 10,
    });
    return Response.json({ ...result, built: true });
  }

  const summary = await summarizeIndex(slug);
  if (url.searchParams.get("preview") !== "1") return Response.json({ summary });

  return Response.json({ summary, preview: await previewBuild(slug, await repoFor(slug)) });
});

const Action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("build") }),
  z.object({ kind: z.literal("clear") }),
]);

/**
 * Build, or throw the index away.
 *
 * The build is synchronous, and on a large repository that means a long request. That is a
 * known limit rather than an oversight: the alternative is the run-record machinery the AI
 * layer uses, and the honest interim answer is the cost preview — the user is told the
 * estimate before committing, which is the information that actually matters. Embedding is
 * incremental, so the long build happens once.
 */
export const POST = route<Ctx>(
  async (req, { params }) => {
    const { slug } = await params;
    const input = await readJson(req, Action);

    if (input.kind === "clear") {
      // Unconditional and always safe. The index is derived; rebuilding is the fix.
      await deleteIndex(slug);
      return Response.json({ summary: await summarizeIndex(slug) });
    }

    const result = await buildIndex(slug, await repoFor(slug));
    return Response.json({ result, summary: await summarizeIndex(slug) });
  },
  { mutating: true },
);

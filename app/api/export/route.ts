import { z } from "zod";

import {
  composeExport,
  EXPORT_FILES,
  previewExport,
  validateTarget,
  writeExport,
  type ExportInput,
} from "@/lib/export";
import { readJson, route } from "@/lib/http";
import { assertSlug } from "@/lib/paths";
import {
  assertProjectParses,
  readAux,
  getLog,
  getProject,
  getQuestions,
  getRisks,
  vaultRoot,
} from "@/lib/vault";
import { RoadmapSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().min(1).max(64),
  target: z.string().min(1).max(4000),
  /** `false` composes and reports; `true` writes. Never inferred from anything else. */
  confirm: z.boolean(),
  /**
   * `name:digest` for each file the browser has shown the user as being replaced.
   *
   * A digest rather than a bare name, because consent is to replacing particular bytes: a
   * file edited between the preview and the click is no longer the file that was shown.
   *
   * `.default([])` is safe here, unusually — it fails *closed*. An absent list means
   * "nothing was acknowledged", so any file the fresh preview would replace stops the
   * write. The usual danger with a default is that it invents consent; this one withholds
   * it.
   */
  acknowledge: z.array(z.string().max(200)).max(EXPORT_FILES.length).default([]),
});

/**
 * Gather everything the export composes from.
 *
 * Read here rather than in `lib/export.ts` so that module stays a composer plus a writer,
 * testable without a vault — which is what lets the whole contract be asserted on its
 * source.
 */
async function gather(slug: string): Promise<ExportInput> {
  /*
   * Refuse a project whose frontmatter did not parse.
   *
   * `readData` swallows a YAML syntax error and returns `{}` so one bad file stays one bad
   * file instead of killing a page. That is right on the read path and destructive here,
   * because zod then fills the gaps: `name` becomes the slug, `stage` becomes "idea",
   * `archetype` becomes "internal-tool". Export would write those three fabrications over a
   * real file, in the one artefact whose whole job is to brief an agent about the project.
   *
   * Hand-edit `name: Portal: rebuild` in Obsidian — an unquoted colon, the classic YAML
   * mistake — and every page still renders, which is exactly why this has to be checked at
   * the point of writing. Both vault patch functions already do the same.
   */
  await assertProjectParses(slug);

  const project = await getProject(slug);
  const [questions, risks, log, roadmap] = await Promise.all([
    getQuestions(slug),
    getRisks(slug),
    getLog(slug),
    readAux(slug, "roadmap.md"),
  ]);

  // Same rule as the roadmap track: a phase a card references but the file does not
  // declare still has to appear, or work on it is invisible.
  const declared = RoadmapSchema.safeParse(roadmap);

  return {
    slug,
    meta: project.meta,
    brief: project.brief,
    phases: declared.success ? declared.data.phases : [],
    cards: project.cards,
    questions,
    risks: risks.risks,
    assumptions: risks.assumptions,
    log,
  };
}

/**
 * Export a plan as a `CLAUDE.md` and a `TASKS.md` an agent can start from.
 *
 * **One endpoint for both steps, and `confirm` is what separates them.** A preview reads
 * the target and returns what is there next to what would replace it; a confirm writes.
 * Both recompose from the vault rather than trusting a body — the browser says *where* to
 * export and *whether* it was confirmed, never *what* to write. That is the same rule the
 * apply route follows for proposals, and for the same reason: otherwise the preview the
 * user approved is advisory.
 *
 * Mutating in both cases, so both get the loopback, Sec-Fetch-Site and Origin guards. A
 * preview is a read of the user's disk driven by a path in a request body; no auth does not
 * mean no boundary.
 */
export const POST = route(
  async (req) => {
    const input = await readJson(req, Body);
    assertSlug(input.slug);

    const target = await validateTarget(input.target, vaultRoot());
    const contents = composeExport(await gather(input.slug));
    const preview = await previewExport(contents, target);

    if (!input.confirm) return Response.json({ preview });

    /*
     * The preview is recomposed here rather than taken from the body, so the target is read
     * again at the moment of writing. That is what makes the acknowledgement meaningful: a
     * file created since the user looked shows up in *this* preview, is not in their list,
     * and stops the write instead of vanishing under it.
     */
    return Response.json({
      preview,
      result: await writeExport(preview, input.acknowledge),
    });
  },
  { mutating: true },
);

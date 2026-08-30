import { AiPanel } from "@/components/ai/AiPanel";
import { Backlinks } from "@/components/links/Backlinks";
import { BriefEditor } from "@/components/editor/BriefEditor";
import { MetaBar } from "@/components/project/MetaBar";
import { ProjectDocProvider } from "@/components/project/ProjectDoc";
import { activeRunFor, pendingRunFor } from "@/lib/runs";
import { getProject } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function BriefPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProject(slug);

  /*
   * Two different questions about the same directory, asked together.
   *
   * `pending` - a run that FINISHED while the tab was closed still has its proposal on
   * disk; offer it rather than making the user run synthesis again.
   *
   * `active` - a run that is STILL WORKING. The run outlives the response that started it,
   * so a tab switch leaves the work going with nothing on screen saying so; without this
   * the page came back showing idle buttons over a locked project.
   *
   * Project-level jobs only in both cases: a card's enhancement belongs to the card, and
   * used to show up here by mistake.
   */
  const [pending, active] = await Promise.all([
    pendingRunFor(slug, { job: ["synthesize", "critique"] }),
    activeRunFor(slug, ["synthesize", "critique"]),
  ]);

  return (
    <ProjectDocProvider slug={slug} initialMtimeMs={project.mtimeMs}>
      {/*
        One vertical rhythm for the whole page. Each panel used to carry its own one-sided
        margin, so wherever two met on the wrong sides there was no gap at all.

        What the Brief is now: the metadata, the document, and the thing that reads it. The
        repository, export and delete panels moved to the Settings tab - they are things you
        do to the project, not parts of the plan, and stacked here they pushed synthesis into
        the middle of a long scroll.
      */}
      <div className="page-blocks">
      <MetaBar meta={project.meta} />
      <BriefEditor initialBody={project.brief} />
      <AiPanel
        slug={slug}
        briefEmpty={project.briefEmpty}
        pendingRunId={pending?.runId ?? null}
        activeRun={active ? { runId: active.runId, startedAt: active.startedAt } : null}
      />
      <Backlinks node={slug} />
      </div>
    </ProjectDocProvider>
  );
}

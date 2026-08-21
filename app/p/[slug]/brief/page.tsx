import { AiPanel } from "@/components/ai/AiPanel";
import { Backlinks } from "@/components/links/Backlinks";
import { BriefEditor } from "@/components/editor/BriefEditor";
import { ExportPanel } from "@/components/project/ExportPanel";
import { MetaBar } from "@/components/project/MetaBar";
import { ProjectDocProvider } from "@/components/project/ProjectDoc";
import { RepoPanel } from "@/components/project/RepoPanel";
import { listRuns } from "@/lib/runs";
import { getProject } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function BriefPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProject(slug);

  // A run that finished while the tab was closed still has its proposal on disk; offer
  // it rather than making the user run synthesis again.
  const pending = (await listRuns(slug)).find((r) => r.status === "ready" && !r.appliedAt);

  return (
    <ProjectDocProvider slug={slug} initialMtimeMs={project.mtimeMs}>
      <MetaBar meta={project.meta} />
      <BriefEditor initialBody={project.brief} />
      {/*
        Below the brief, above the AI panel, and that order is the argument: the brief says
        what is intended, the repo is what exists, and synthesis reads both. Rendered as a
        slot inside the provider because connecting writes project.md, which the editor and
        the meta bar also write - one baseline for the file, per CLAUDE.md.
      */}
      <RepoPanel meta={project.meta} />
      <AiPanel
        slug={slug}
        briefEmpty={project.briefEmpty}
        pendingRunId={pending?.runId ?? null}
      />
      {/*
        Last, because it is the last thing you do: the plan has to exist before it is worth
        handing to an agent.
      */}
      <ExportPanel slug={slug} name={project.meta.name} />
      <Backlinks node={slug} />
    </ProjectDocProvider>
  );
}

import { AiPanel } from "@/components/ai/AiPanel";
import { Backlinks } from "@/components/links/Backlinks";
import { BriefEditor } from "@/components/editor/BriefEditor";
import { MetaBar } from "@/components/project/MetaBar";
import { ProjectDocProvider } from "@/components/project/ProjectDoc";
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
      <AiPanel
        slug={slug}
        briefEmpty={project.briefEmpty}
        pendingRunId={pending?.runId ?? null}
      />
      <Backlinks node={slug} />
    </ProjectDocProvider>
  );
}

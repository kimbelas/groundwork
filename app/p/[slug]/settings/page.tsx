import { DeleteProject } from "@/components/project/DeleteProject";
import { ExportPanel } from "@/components/project/ExportPanel";
import { ProjectDocProvider } from "@/components/project/ProjectDoc";
import { RepoPanel } from "@/components/project/RepoPanel";
import { getProject } from "@/lib/vault";

export const dynamic = "force-dynamic";

/**
 * Everything about the project that is not the plan.
 *
 * These three panels lived at the foot of the Brief, and none of them belonged there: the
 * Brief is a document you write, and connecting a repository, exporting for an agent and
 * deleting the project are things you do to the project as a whole. Stacked under an editor
 * they also pushed the AI panel — the thing you actually came to the Brief for — into the
 * middle of a long scroll.
 *
 * The provider wraps them because two of the three write `project.md`: `RepoConnect` patches
 * the `repo` field and `DeleteProject` removes the file. One baseline for that file, per
 * CLAUDE.md, even on a page where nothing else is writing — it is the mechanism that keeps
 * the mtime a write carries the one the previous write returned, and a second baseline here
 * would be the same last-writer-wins hazard however quiet the page is.
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProject(slug);

  return (
    <ProjectDocProvider slug={slug} initialMtimeMs={project.mtimeMs}>
      <div className="page-blocks">
        {/*
          Connect first: it is the one with an ongoing relationship to the project, and the
          only one of the three you come back to.
        */}
        <RepoPanel meta={project.meta} />

        <ExportPanel slug={slug} name={project.meta.name} />

        {/*
          Last, and still last for the same reason it was last on the Brief: you should have
          to scroll past everything else before you are offered the button that removes the
          project.
        */}
        <DeleteProject name={project.meta.name} />
      </div>
    </ProjectDocProvider>
  );
}

import { PhaseTrack } from "@/components/roadmap/PhaseTrack";
import { getProject } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function RoadmapPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProject(slug);

  return (
    <PhaseTrack
      phases={project.phases}
      cards={project.cards}
      doneColumn={project.meta.columns[project.meta.columns.length - 1]}
    />
  );
}

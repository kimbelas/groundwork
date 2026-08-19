import { notFound } from "next/navigation";

import { ProjectTabs } from "@/components/project/ProjectTabs";
import { isVaultError } from "@/lib/errors";
import { getProject } from "@/lib/vault";

export const dynamic = "force-dynamic";

/**
 * Project chrome: the title and the view tabs, shared by every view so switching tabs
 * never re-renders the header.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let name: string;
  let openQuestions: number;
  try {
    const project = await getProject(slug);
    name = project.meta.name;
    openQuestions = project.openQuestions;
  } catch (e) {
    // A bad slug or a missing project is a 404, not a 500. Anything else is a real
    // fault and should surface as one.
    if (isVaultError(e) && (e.code === "not_found" || e.code === "invalid_slug")) notFound();
    throw e;
  }

  return (
    <>
      <h1 className="display-lg" style={{ margin: "0 0 10px" }}>
        {name}
      </h1>
      <ProjectTabs slug={slug} openQuestions={openQuestions} />
      {children}
    </>
  );
}

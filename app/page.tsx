import Link from "next/link";

import { NewProject } from "@/components/project/NewProject";
import { Chip } from "@/components/ui/Chip";
import { healthTone, progress, relativeTime, stageTone } from "@/lib/format";
import { healthLabel, stageLabel } from "@/lib/labels";
import { nextAction } from "@/lib/nextAction";
import { listProjects } from "@/lib/vault";

export const dynamic = "force-dynamic";

/**
 * Reading the clock belongs with the data load, not in the render body: render must
 * stay pure, and one timestamp for the whole table is more correct than one per row.
 */
async function loadDashboard() {
  const entries = await listProjects();
  return { entries, now: Date.now() };
}

/**
 * The dashboard. Every project, its stage, and the single thing it needs next.
 *
 * The archived toggle is a search param rather than client state so the view stays a
 * server component, renders in one pass, and is linkable.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const { entries: all, now } = await loadDashboard();
  const entries = showArchived
    ? all
    : all.filter((e) => !e.ok || e.summary.meta.stage !== "archived");

  const archivedCount = all.filter((e) => e.ok && e.summary.meta.stage === "archived").length;

  return (
    <>
      <header
        className="row"
        style={{ justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}
      >
        <h1 className="display-lg" style={{ margin: 0 }}>
          Projects
        </h1>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          {archivedCount > 0 && (
            <Link href={showArchived ? "/" : "/?archived=1"} className="link-button">
              {showArchived ? "hide archived" : `show archived (${archivedCount})`}
            </Link>
          )}
          <NewProject />
        </div>
      </header>

      {entries.length === 0 ? (
        <div className="empty">
          <p className="display-sm" style={{ margin: "0 0 6px" }}>
            The vault is empty
          </p>
          <p className="body-sm" style={{ margin: "0 0 18px" }}>
            Start one with the button above, or drop a folder into{" "}
            <code className="mono">vault/</code> containing a{" "}
            <code className="mono">project.md</code> — either way it appears here.
          </p>
          <NewProject />
        </div>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Stage</th>
                <th scope="col">Health</th>
                <th scope="col">Phase</th>
                <th scope="col">Open</th>
                <th scope="col">Next action</th>
                <th scope="col">Touched</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                if (!entry.ok) {
                  return (
                    <tr key={entry.slug}>
                      <td data-label="Project">
                        <span className="project-name faint">{entry.slug}</span>
                      </td>
                      <td colSpan={6} data-label="Status">
                        <span className="chip chip-blocked">unreadable</span>{" "}
                        <span className="body-sm soft">{entry.error}</span>
                      </td>
                    </tr>
                  );
                }

                const { summary } = entry;
                const { done, total } = progress(summary);
                const action = nextAction(summary);

                return (
                  <tr key={entry.slug}>
                    <td data-label="Project">
                      <Link href={`/p/${entry.slug}/brief`} className="project-name">
                        {summary.meta.name}
                      </Link>
                      {summary.warnings.length > 0 && (
                        <span className="mono-sm faint" title={summary.warnings.join("\n")}>
                          {" "}
                          {summary.warnings.length} warning
                          {summary.warnings.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </td>
                    <td data-label="Stage">
                      <Chip tone={stageTone(summary.meta.stage)}>{stageLabel(summary.meta.stage)}</Chip>
                    </td>
                    <td data-label="Health">
                      <Chip tone={healthTone(summary.meta.health)}>{healthLabel(summary.meta.health)}</Chip>
                    </td>
                    <td className="num" data-label="Phase">
                      {total === 0 ? "—" : `${done}/${total}`}
                    </td>
                    <td className="num" data-label="Open">{summary.openQuestions || "—"}</td>
                    <td data-label="Next action">
                      <Link href={`/p/${entry.slug}/${action.view}`}>{action.text}</Link>
                    </td>
                    <td className="num" data-label="Touched">{relativeTime(summary.lastTouchedMs, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

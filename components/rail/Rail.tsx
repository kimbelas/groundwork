import Link from "next/link";

import { listProjects } from "@/lib/vault";

/**
 * The vault tree. A server component so the first paint needs no client fetch —
 * adding a folder to vault/ by hand makes it appear here on refresh, with no other
 * action required.
 */
export async function Rail() {
  const entries = await listProjects();
  const visible = entries.filter((e) => !e.ok || e.summary.meta.stage !== "archived");

  return (
    <nav className="rail" aria-label="Vault">
      <Link href="/" className="rail-brand">
        Groundwork
      </Link>
      <hr className="rule" />

      <Link href="/search" className="rail-link">
        Search
      </Link>

      <div className="rail-section label">Projects</div>

      {visible.length === 0 ? (
        <p className="body-sm soft" style={{ padding: "4px 16px" }}>
          No projects yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {visible.map((entry) => (
            <li key={entry.slug}>
              {entry.ok ? (
                <Link href={`/p/${entry.slug}/brief`} className="rail-link">
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {entry.summary.meta.name}
                  </span>
                  {entry.summary.openQuestions > 0 && (
                    <span className="mono faint" title="Open questions">
                      {entry.summary.openQuestions}?
                    </span>
                  )}
                </Link>
              ) : (
                <span className="rail-link faint" title={entry.error}>
                  <span>{entry.slug}</span>
                  <span className="mono">!</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

import { Chip } from "@/components/ui/Chip";
import { describeRepo } from "@/lib/repo";
import type { ProjectMeta } from "@/lib/schema";

import { IndexPanel } from "./IndexPanel";
import { RepoConnect } from "./RepoConnect";

/**
 * The repository a project plans against.
 *
 * A repo is a property of a project, not an entity with its own lifecycle — one optional
 * frontmatter field, hand-editable in Obsidian like everything else. That framing is why
 * this is a panel on the brief page and not a registry screen.
 *
 * Reads status on the server so a missing directory is visible immediately rather than
 * after a failed action. `describeRepo` is one `stat` and never throws: a project whose
 * repo has been renamed or unplugged has to keep rendering, and saying so is the entire
 * value of showing status at all.
 *
 * Read-only. Nothing in the app writes to a connected repo, and nothing may — the
 * argument for that boundary, and the runtime check enforcing it against spawned AI runs,
 * are in `lib/repo.ts` and `lib/ai/scope.ts`.
 */
export async function RepoPanel({ meta }: { meta: ProjectMeta }) {
  const status = meta.repo ? await describeRepo(meta.repo) : null;

  return (
    <section className="repo-panel" data-testid="repo-panel" aria-labelledby="repo-heading">
      <div className="repo-head">
        <h2 id="repo-heading" className="repo-title">
          Repository
        </h2>
        {status && (
          <Chip tone={status.exists ? "active" : "blocked"}>
            {status.exists ? "Connected" : "Not found"}
          </Chip>
        )}
      </div>

      {status ? (
        <>
          {/* The full path, in mono, because it is a path and gets compared by eye. */}
          <p className="repo-path" data-testid="repo-connected">
            {status.path}
          </p>
          {status.exists ? (
            <p className="repo-note body-sm">
              Planning for this project can read the code here. Groundwork never writes to
              it.
            </p>
          ) : (
            <p className="repo-note body-sm">
              This directory has moved or is unavailable. The link is kept so it can be
              fixed rather than silently dropped — reconnect it or disconnect it.
            </p>
          )}
        </>
      ) : (
        <p className="repo-note body-sm">
          Connect a repository and planning is grounded in the code that exists, not only
          in what the brief claims. Give an absolute path to a directory on this machine.
        </p>
      )}

      <RepoConnect connected={status?.path ?? null} />

      {/*
        The index only appears once a repo exists to index. Showing the control before that
        would be a button whose only possible outcome is an error, and the panel is already
        the place that explains what connecting a repo is for.
      */}
      {status?.exists && <IndexPanel slug={meta.slug} />}
    </section>
  );
}

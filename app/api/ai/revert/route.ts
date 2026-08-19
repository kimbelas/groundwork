import path from "node:path";
import { z } from "zod";

import { buildRevertMessage, commitPaths } from "@/lib/git";
import { readJson, route } from "@/lib/http";
import { assertSlug } from "@/lib/paths";
import { listRuns, updateRun } from "@/lib/runs";
import { listSnapshots, restoreLatestSnapshot, vaultRoot } from "@/lib/vault";

export const dynamic = "force-dynamic";

const Body = z.object({ slug: z.string().min(1).max(64) });

/**
 * Undo the newest apply.
 *
 * The revert is itself committed rather than rewinding history: `git log` should read
 * as what happened, including the decision to undo. That also leaves `git revert` as an
 * independent second undo path if a snapshot is ever lost.
 */
export const POST = route(
  async (req) => {
    const { slug } = await readJson(req, Body);
    assertSlug(slug);

    const result = await restoreLatestSnapshot(slug);

    // Commit whatever the restore actually changed, scoped to this project.
    const commit = await commitPaths(
      vaultRoot(),
      [path.posix.join(slug, ".")],
      buildRevertMessage(result.runId, result.snapshotId),
    );

    // Let the run be applied again now that its effect has been undone.
    const run = (await listRuns(slug)).find((r) => r.runId === result.runId);
    if (run) await updateRun(run.runId, { appliedAt: undefined });

    return Response.json({ ...result, commit });
  },
  { mutating: true },
);

/** Whether there is anything to revert, for enabling the control. */
export const GET = route(async (req) => {
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  assertSlug(slug);

  const [latest] = await listSnapshots(slug);
  return Response.json({
    available: Boolean(latest),
    snapshotId: latest?.id ?? null,
    runId: latest?.manifest.runId ?? null,
  });
});

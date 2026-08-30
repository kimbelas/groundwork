import { z } from "zod";

import { VaultError } from "@/lib/errors";
import { route } from "@/lib/http";
import { assertSlug } from "@/lib/paths";
import { listCardRuns, readRun } from "@/lib/runs";

export const dynamic = "force-dynamic";

/**
 * Ask by card, or ask by run id. Exactly one, refused otherwise.
 *
 * `slug` is required either way, and for a single run it is not decoration: the record is
 * checked against it below. Run ids are guessable — they are a timestamp — so answering
 * without that check would let one project's page read another project's run.
 */
const Query = z.object({
  slug: z.string().min(1).max(64),
  cardId: z.coerce.number().int().positive().optional(),
  runId: z.string().min(1).max(64).optional(),
});

/**
 * The runs recorded against one card, newest first — what the card drawer and the card
 * page use to offer a finished enhancement again and to list past ones.
 *
 * With `runId` instead, one run's record. That is what the brief panel polls after it
 * rediscovers a run that was already in flight when the page loaded: the stream that
 * started the run belongs to whichever tab started it, and a tab that arrives later has
 * no way back into it. Polling one small JSON file every few seconds is the cheap answer,
 * and it is the same file the run itself keeps up to date.
 *
 * Read-only, and it cannot 500 on a half-written record: `listRuns` drops anything it
 * cannot parse and `readRun` returns null. It is a directory scan, not an index; fine at
 * this app's scale.
 */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    slug: url.searchParams.get("slug"),
    ...(url.searchParams.get("cardId") ? { cardId: url.searchParams.get("cardId") } : {}),
    ...(url.searchParams.get("runId") ? { runId: url.searchParams.get("runId") } : {}),
  });
  if (!parsed.success) throw new VaultError("invalid_document", "Bad slug, cardId or runId");
  assertSlug(parsed.data.slug);

  const { slug, cardId, runId } = parsed.data;

  if ((runId === undefined) === (cardId === undefined)) {
    throw new VaultError("invalid_document", "Ask for either a cardId or a runId, not both");
  }

  if (runId !== undefined) {
    const run = await readRun(runId);
    /*
     * A run belonging to another project reads as absent rather than as a refusal. There is
     * nothing to protect here beyond not answering, and a 404-shaped null keeps the caller's
     * handling identical to the "this run was cleaned up" case it already has to cover.
     */
    return Response.json({ run: run && run.slug === slug ? run : null });
  }

  return Response.json({ runs: await listCardRuns(slug, cardId as number) });
});

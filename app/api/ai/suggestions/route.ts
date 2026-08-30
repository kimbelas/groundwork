import { z } from "zod";

import { VaultError } from "@/lib/errors";
import { route } from "@/lib/http";
import { assertRunId, readRun, readSuggestions } from "@/lib/runs";

export const dynamic = "force-dynamic";

const Query = z.object({
  runId: z.string().min(1).max(64),
  slug: z.string().min(1).max(64),
});

/**
 * The candidate answers a `suggest-answers` run produced.
 *
 * Separate from `/api/ai/proposal` because the two documents are different shapes and the
 * validator has to match: a proposal read with the suggestions schema, or the reverse, is a
 * confusing failure rather than a clean one. The run record's `job` decides which this is,
 * and it is read from disk rather than trusted from the query string.
 *
 * `slug` is required and verified. Run ids are timestamps, so they are guessable, and one
 * project's page must not be able to read another project's run.
 */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    runId: url.searchParams.get("runId"),
    slug: url.searchParams.get("slug"),
  });
  if (!parsed.success) throw new VaultError("invalid_document", "Bad runId or slug");
  assertRunId(parsed.data.runId);

  const record = await readRun(parsed.data.runId);
  if (!record || record.slug !== parsed.data.slug) {
    throw new VaultError("not_found", "No such run for this project");
  }
  if (record.job !== "suggest-answers") {
    throw new VaultError("invalid_document", `Run ${record.runId} is a ${record.job} run`);
  }

  return Response.json(await readSuggestions(parsed.data.runId));
});

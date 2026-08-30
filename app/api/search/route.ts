import { z } from "zod";

import { route } from "@/lib/http";
import { searchVault } from "@/lib/vault";

export const dynamic = "force-dynamic";

const Query = z.object({
  /*
   * One character is allowed through to `searchVault`, which is where the minimum now lives.
   *
   * It has to be, because the rule is no longer about length: a single letter is a scan of
   * every line in the vault, and a single digit is an exact card-number lookup answered from
   * a cached index. `searchVault` can tell those apart and this schema cannot, so refusing
   * here would refuse the useful one along with the useless one. A one-letter query still
   * comes back empty — it just gets refused one layer down.
   */
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Vault-wide text search.
 *
 * Capped results, and a minimum of two characters for *text* — a single letter would match
 * nearly every line in the vault and turn a linear scan into a slow way of returning noise.
 * A single digit is exempt: it is a card number, answered from the link graph without
 * touching the disk. `searchVault` draws that line; see the schema below.
 */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    q: url.searchParams.get("q") ?? "",
    ...(url.searchParams.get("limit") ? { limit: url.searchParams.get("limit") } : {}),
  });

  if (!parsed.success) return Response.json({ hits: [], query: "" });

  const hits = await searchVault(parsed.data.q, parsed.data.limit ?? 60);
  return Response.json({ hits, query: parsed.data.q });
});

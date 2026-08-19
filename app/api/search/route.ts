import { z } from "zod";

import { route } from "@/lib/http";
import { searchVault } from "@/lib/vault";

export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Vault-wide text search.
 *
 * A minimum of two characters, capped results: a single-letter query would match nearly
 * every line in the vault and turn a linear scan into a very slow way of returning noise.
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

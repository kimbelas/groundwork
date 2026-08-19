import { z } from "zod";

import { readJson, route } from "@/lib/http";
import { formatDecision } from "@/lib/log";
import { assertSlug } from "@/lib/paths";
import { prependLog } from "@/lib/vault";

export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  considered: z.string().max(2000).default(""),
  because: z.string().max(2000).default(""),
});

/**
 * Append a decision.
 *
 * No PATCH and no DELETE, deliberately: the log is prepend-only. Its whole value is
 * that it records what was thought at the time, and an entry that can be revised later
 * cannot carry that.
 *
 * The date is stamped server-side so an entry cannot be backdated from the browser.
 */
export const POST = route(
  async (req) => {
    const input = await readJson(req, Body);
    assertSlug(input.slug);

    const entry = formatDecision({
      date: new Date().toISOString().slice(0, 10),
      title: input.title,
      considered: input.considered,
      because: input.because,
    });

    const { mtimeMs } = await prependLog(input.slug, entry);
    return Response.json({ mtimeMs, entry });
  },
  { mutating: true },
);

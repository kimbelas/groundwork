import { z } from "zod";

import { readJson, route } from "@/lib/http";
import { assertSlug } from "@/lib/paths";
import { auxMtime, getRisks, setAssumptionValidated } from "@/lib/vault";

export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().min(1).max(64),
  id: z.string().min(1).max(32),
  validated: z.boolean(),
  expectedMtimeMs: z.number().finite(),
});

export const GET = route(async (req) => {
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  assertSlug(slug);
  return Response.json({
    ...(await getRisks(slug)),
    mtimeMs: await auxMtime(slug, "risks.md"),
  });
});

/**
 * Validating an assumption is the only edit this route allows.
 *
 * Risks and assumptions are added through the AI proposal path or by hand in the file;
 * marking one validated is the single state change that belongs to day-to-day use.
 */
export const PATCH = route(
  async (req) => {
    const input = await readJson(req, Body);
    assertSlug(input.slug);

    return Response.json(
      await setAssumptionValidated(
        input.slug,
        input.id,
        input.validated,
        input.expectedMtimeMs,
      ),
    );
  },
  { mutating: true },
);

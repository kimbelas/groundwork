import { z } from "zod";

import { readJson, route } from "@/lib/http";
import { assertSlug } from "@/lib/paths";
import { auxMtime, getQuestions, setQuestionAnswer } from "@/lib/vault";

export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().min(1).max(64),
  id: z.string().min(1).max(32),
  /** Empty or null reopens the question. */
  answer: z.string().max(4000).nullable(),
  expectedMtimeMs: z.number().finite(),
});

export const GET = route(async (req) => {
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  assertSlug(slug);
  return Response.json({
    questions: await getQuestions(slug),
    mtimeMs: await auxMtime(slug, "questions.md"),
  });
});

export const PATCH = route(
  async (req) => {
    const input = await readJson(req, Body);
    assertSlug(input.slug);

    const result = await setQuestionAnswer(
      input.slug,
      input.id,
      input.answer,
      input.expectedMtimeMs,
    );
    return Response.json(result);
  },
  { mutating: true },
);

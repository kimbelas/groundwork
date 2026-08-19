import { z } from "zod";

import { readJson, route } from "@/lib/http";
import { PRIORITIES, SIZES } from "@/lib/schema";
import {
  createCard,
  getCard,
  moveCard,
  patchCardMeta,
  trashCard,
  writeCardBody,
} from "@/lib/vault";

export const dynamic = "force-dynamic";

const Slug = z.string().min(1).max(64);
const CardId = z.number().int().positive();

const CreateBody = z.object({
  slug: Slug,
  title: z.string().min(1).max(200),
  column: z.string().min(1).max(60),
  phase: z.number().int().positive().nullable().optional(),
});

/**
 * A move says *where*, never what `order` value to write. Ordering arithmetic belongs
 * to the server so two clients can never disagree about it.
 */
const MoveBody = z.object({
  kind: z.literal("move"),
  slug: Slug,
  id: CardId,
  column: z.string().min(1).max(60),
  index: z.number().int().min(0).max(10_000),
  expectedMtimeMs: z.number().finite().optional(),
});

const BodyBody = z.object({
  kind: z.literal("body"),
  slug: Slug,
  id: CardId,
  body: z.string(),
  expectedMtimeMs: z.number().finite(),
});

const MetaBody = z.object({
  kind: z.literal("meta"),
  slug: Slug,
  id: CardId,
  expectedMtimeMs: z.number().finite(),
  patch: z
    .object({
      title: z.string().min(1).max(200).optional(),
      priority: z.enum(PRIORITIES).optional(),
      size: z.enum(SIZES).optional(),
      confidence: z.number().min(0).max(1).optional(),
      blocked: z.boolean().optional(),
      phase: z.number().int().positive().nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "Patch must change at least one field"),
});

const DeleteBody = z.object({ slug: Slug, id: CardId });

const Patch = z.discriminatedUnion("kind", [MoveBody, BodyBody, MetaBody]);

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const slug = Slug.parse(url.searchParams.get("slug"));
  const id = CardId.parse(Number(url.searchParams.get("id")));
  return Response.json(await getCard(slug, id));
});

export const POST = route(
  async (req) => {
    const input = await readJson(req, CreateBody);
    const card = await createCard(input.slug, {
      title: input.title,
      column: input.column,
      phase: input.phase ?? null,
    });
    return Response.json(card, { status: 201 });
  },
  { mutating: true },
);

export const PATCH = route(
  async (req) => {
    const input = await readJson(req, Patch);

    if (input.kind === "move") {
      const result = await moveCard(
        input.slug,
        input.id,
        input.column,
        input.index,
        input.expectedMtimeMs,
      );
      const card = await getCard(input.slug, input.id);
      return Response.json({ ...result, mtimeMs: card.mtimeMs, order: card.order });
    }

    if (input.kind === "body") {
      const { mtimeMs } = await writeCardBody(
        input.slug,
        input.id,
        input.body,
        input.expectedMtimeMs,
      );
      return Response.json({ mtimeMs });
    }

    const { mtimeMs, meta } = await patchCardMeta(
      input.slug,
      input.id,
      input.patch,
      input.expectedMtimeMs,
    );
    return Response.json({ mtimeMs, meta });
  },
  { mutating: true },
);

export const DELETE = route(
  async (req) => {
    const input = await readJson(req, DeleteBody);
    await trashCard(input.slug, input.id);
    return Response.json({ trashed: true });
  },
  { mutating: true },
);

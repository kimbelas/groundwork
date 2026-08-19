import { z } from "zod";

import { getEngine } from "@/lib/ai/engine";
import type { AiEvent, AiJob } from "@/lib/ai/types";
import { VaultError } from "@/lib/errors";
import { assertTrustedRequest, errorResponse } from "@/lib/http";
import {
  acquireLock,
  createRun,
  makeRunId,
  readLock,
  releaseLock,
  updateRun,
} from "@/lib/runs";
import { assertSlug } from "@/lib/paths";

export const dynamic = "force-dynamic";

const Query = z.object({
  job: z.enum(["synthesize", "enhance-card", "critique"]),
  slug: z.string().min(1).max(64),
  cardId: z.coerce.number().int().positive().optional(),
});

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Start a run and stream its progress.
 *
 * Two things here are deliberate and easy to get wrong:
 *
 *  - **The run outlives the response.** Synthesis takes minutes; closing the tab must
 *    not kill it. The work is started outside the stream's lifetime and the proposal
 *    lands on disk regardless of whether anyone is still listening.
 *  - **The lock is released by the run, not by the stream.** Tying it to the response
 *    would free the lock the moment a tab closed, letting a second run start against a
 *    project the first is still working on.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);

    if (url.searchParams.get("action") === "stop") {
      assertTrustedRequest(req);
      const { stopCurrentRun } = await import("@/lib/ai/claude-cli");
      const stopped = stopCurrentRun();
      if (stopped) await updateRun(stopped, { status: "stopped", finishedAt: new Date().toISOString() });
      releaseLock();
      return Response.json({ stopped });
    }

    const parsed = Query.safeParse({
      job: url.searchParams.get("job"),
      slug: url.searchParams.get("slug"),
      ...(url.searchParams.get("cardId")
        ? { cardId: url.searchParams.get("cardId") }
        : {}),
    });
    if (!parsed.success) {
      throw new VaultError("invalid_document", "Bad job, slug or cardId");
    }
    assertSlug(parsed.data.slug);

    if (parsed.data.job === "enhance-card" && parsed.data.cardId === undefined) {
      throw new VaultError("invalid_document", "enhance-card needs a cardId");
    }

    const runId = makeRunId();
    if (!acquireLock(runId)) {
      const held = readLock();
      throw new VaultError(
        "conflict",
        held
          ? `A run is already in progress (${held.runId}). Wait for it to finish or stop it.`
          : "A run is already in progress.",
      );
    }

    const job: AiJob =
      parsed.data.job === "enhance-card"
        ? { kind: "enhance-card", slug: parsed.data.slug, cardId: parsed.data.cardId as number }
        : { kind: parsed.data.job, slug: parsed.data.slug };

    await createRun({
      runId,
      slug: parsed.data.slug,
      job: parsed.data.job,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(sse(event, data)));
          } catch {
            closed = true; // the client went away; the run continues regardless
          }
        };

        send("run", { runId });

        const onEvent = (e: AiEvent) => {
          if (e.type === "step") send("step", { label: e.label });
        };

        void (async () => {
          try {
            const engine = await getEngine();
            await engine.run(job, runId, onEvent);
            await updateRun(runId, { status: "ready", finishedAt: new Date().toISOString() });
            send("done", { runId });
          } catch (e) {
            const message = (e as Error).message;
            await updateRun(runId, {
              status: "failed",
              finishedAt: new Date().toISOString(),
              error: message,
            }).catch(() => undefined);
            send("failed", { runId, message });
          } finally {
            releaseLock();
            if (!closed) {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
            closed = true;
          }
        })();
      },

      cancel() {
        // The browser hung up. The run keeps going and writes its proposal.
        closed = true;
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

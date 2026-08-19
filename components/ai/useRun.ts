"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RunPhase = "idle" | "running" | "ready" | "failed";

export interface RunState {
  phase: RunPhase;
  runId: string | null;
  steps: string[];
  error: string | null;
}

/**
 * Drives one AI run over Server-Sent Events.
 *
 * Uses `fetch` with a manual reader rather than `EventSource` for one reason that
 * matters: `EventSource` reconnects automatically when a stream ends, which here would
 * start a brand new run every time one finished.
 *
 * Progress is a list of named steps, never a spinner. A three-minute run that shows
 * only a spinner is indistinguishable from a hung one.
 */
export function useRun(slug: string) {
  const [state, setState] = useState<RunState>({
    phase: "idle",
    runId: null,
    steps: [],
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const start = useCallback(
    async (job: "synthesize" | "critique" | "enhance-card", cardId?: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ phase: "running", runId: null, steps: [], error: null });

      const params = new URLSearchParams({ job, slug });
      if (cardId !== undefined) params.set("cardId", String(cardId));

      let res: Response;
      try {
        res = await fetch(`/api/ai/run?${params.toString()}`, { signal: controller.signal });
      } catch (e) {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, phase: "failed", error: (e as Error).message }));
        return;
      }

      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        setState((s) => ({
          ...s,
          phase: "failed",
          error: detail.error ?? `Could not start the run (${res.status})`,
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; a chunk can split one.
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            const eventLine = frame.split("\n").find((l) => l.startsWith("event: "));
            const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!eventLine || !dataLine) continue;

            const event = eventLine.slice(7).trim();
            let data: Record<string, unknown> = {};
            try {
              data = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (event === "run") {
              setState((s) => ({ ...s, runId: String(data.runId ?? "") }));
            } else if (event === "step") {
              setState((s) => ({ ...s, steps: [...s.steps, String(data.label ?? "")] }));
            } else if (event === "done") {
              setState((s) => ({ ...s, phase: "ready", runId: String(data.runId ?? s.runId) }));
            } else if (event === "failed") {
              setState((s) => ({
                ...s,
                phase: "failed",
                error: String(data.message ?? "The run failed."),
              }));
            }
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setState((s) => ({ ...s, phase: "failed", error: (e as Error).message }));
        }
      }
    },
    [slug],
  );

  const reset = useCallback(() => {
    setState({ phase: "idle", runId: null, steps: [], error: null });
  }, []);

  return { ...state, start, reset };
}

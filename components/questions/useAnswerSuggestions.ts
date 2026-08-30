"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRun } from "@/components/ai/useRun";

import type { AnswerOption } from "@/lib/ai/types";

/** How often an adopted run's record is re-read. Same cadence as the brief panel. */
const POLL_MS = 3_000;

export interface SuggestionsState {
  /** Options keyed by question id. Empty until a run has produced some. */
  byQuestion: ReadonlyMap<string, AnswerOption[]>;
  running: boolean;
  /** Set when a run failed, or produced output the app could not read. */
  error: string | null;
  summary: string;
  start: () => void;
}

interface RawSuggestions {
  ok: boolean;
  error?: string;
  suggestions?: {
    summary: string;
    questions: { questionId: string; options: AnswerOption[] }[];
  };
}

/**
 * Drives a `suggest-answers` run and hands back its options.
 *
 * ## Why this is a hook and not a component
 *
 * The options belong *inside* each question, next to the box they fill, and the draft state
 * they write to is owned by `QuestionsList`. A component would either have to lift that
 * state or duplicate it; a hook lets the list keep owning its drafts and just render what
 * this returns.
 *
 * ## Adopting a run
 *
 * Same problem the brief panel had: the run outlives the response that started it, so
 * leaving the page aborts the stream while the work carries on. `activeRunId` is found on
 * the server at render time and adopted here — the buttons stay disabled and the options
 * appear when the record settles, without a reload.
 *
 * `readyRunId` is the other half: a run that finished while the tab was closed still has
 * its output on disk, and re-running the model to see it again would be absurd.
 */
export function useAnswerSuggestions(
  slug: string,
  activeRunId: string | null,
  readyRunId: string | null,
  /** Ids of the questions currently open. Suggestions are fetched for these unasked. */
  openIds: readonly string[],
): SuggestionsState {
  const run = useRun(slug);

  /*
   * Overrides keyed by run id, never a copy of the server value. `useState(prop)` ignores a
   * changed initial value, so a component seeded from a prop freezes at first render — the
   * rule in CLAUDE.md, and the bug it exists for.
   */
  const [settled, setSettled] = useState<Record<string, string>>({});
  /** Whether this mount has already spawned a run. See the auto-start effect below. */
  const started = useRef(false);
  const [loaded, setLoaded] = useState<RawSuggestions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adoptedId = activeRunId && !settled[activeRunId] ? activeRunId : null;

  // Whichever run has output to show: the one this tab just finished, the one it adopted
  // and watched finish, or one that finished before the page was opened.
  const showRunId =
    run.phase === "ready" && run.runId
      ? run.runId
      : activeRunId && settled[activeRunId] === "ready"
        ? activeRunId
        : readyRunId;

  const running = run.phase === "running" || adoptedId !== null;

  // Watch an adopted run until its record stops saying `running`.
  useEffect(() => {
    if (adoptedId === null) return;
    let cancelled = false;

    const check = async () => {
      try {
        const params = new URLSearchParams({ slug, runId: adoptedId });
        const res = await fetch(`/api/ai/runs?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { run: { status: string } | null };
        // A missing record settles it too, or the page stays disabled forever.
        const status = data.run?.status ?? "gone";
        if (status === "running") return;
        setSettled((s) => ({ ...s, [adoptedId]: status }));
      } catch {
        /* transient; the next tick asks again */
      }
    };

    const timer = setInterval(() => void check(), POLL_MS);
    void check();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [adoptedId, slug]);

  // Fetch the output once there is a run to read.
  useEffect(() => {
    if (!showRunId) return;
    let cancelled = false;

    void (async () => {
      try {
        const params = new URLSearchParams({ slug, runId: showRunId });
        const res = await fetch(`/api/ai/suggestions?${params.toString()}`);
        const data = (await res.json()) as RawSuggestions & { error?: string };
        if (cancelled) return;

        if (!res.ok) {
          setError(data.error ?? `Could not read the suggestions (${res.status})`);
          return;
        }
        setLoaded(data);
        setError(data.ok ? null : (data.error ?? "The run produced something unusable."));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showRunId, slug]);

  const byQuestion = useMemo(() => {
    const map = new Map<string, AnswerOption[]>();
    for (const q of loaded?.suggestions?.questions ?? []) {
      if (q.options.length > 0) map.set(q.questionId, q.options);
    }
    return map;
  }, [loaded]);

  const start = useCallback(() => {
    setError(null);
    setLoaded(null);
    void run.start("suggest-answers");
  }, [run]);

  /*
   * Start one on arrival, rather than behind a button.
   *
   * A question with no options is a question you answer from a blank box - the situation
   * this exists to remove - so waiting for a click withheld the help exactly when it was
   * most useful, on the first visit.
   *
   * Guarded three ways, because this spawns a model run:
   *
   *  - `started` is a ref, so it fires at most once per mount. Keying it on the question ids
   *    would look more precise and would re-run forever against a model that legitimately
   *    returned nothing for one of them.
   *  - Nothing starts while a run is in flight, or once one has been read. Coming back to
   *    this tab therefore does not queue a second.
   *  - A failure does not retry. One run that produced nothing is a message; a loop of them
   *    is a bill.
   */
  const uncovered = openIds.some((id) => !byQuestion.has(id));
  const settledAny = loaded !== null || error !== null;

  useEffect(() => {
    if (started.current) return;
    if (openIds.length === 0 || !uncovered) return;
    if (running || settledAny || showRunId) return;

    /*
     * Scheduled, not called in the effect body.
     *
     * Starting a run sets state, and doing that synchronously inside an effect cascades
     * renders - the lint rule says so and CLAUDE.md records the same rule for resetting
     * child state. A task scheduled after commit is the honest shape: the run is an
     * external system, and this is the moment we ask it to begin.
     *
     * The ref is set INSIDE the callback rather than before it, which is load-bearing under
     * StrictMode: it mounts, cleans up, and mounts again, so a ref set eagerly would be true
     * on the second pass while the only scheduled start had already been cancelled - and no
     * run would ever begin. Set on firing, it survives that dance.
     */
    const timer = setTimeout(() => {
      started.current = true;
      start();
    }, 0);
    return () => clearTimeout(timer);
  }, [openIds.length, uncovered, running, settledAny, showRunId, start]);

  return {
    byQuestion,
    running,
    error: error ?? (run.phase === "failed" ? run.error : null),
    summary: loaded?.suggestions?.summary ?? "",
    start,
  };
}

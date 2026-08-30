"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Notice } from "@/components/ui/Notice";

import { EnhanceHistory } from "./EnhanceHistory";
import { ProposalReview } from "./ProposalReview";
import { useRun } from "./useRun";

import type { AccountStatus } from "@/lib/ai/account";
import type { RunRecord } from "@/lib/ai/types";

/** Same age as the lock file's stale rule in lib/runs.ts. */
const STALE_RUN_MS = 30 * 60_000;
const POLL_MS = 4000;
/** Ten minutes of watching; a run that long is not coming back through this drawer. */
const MAX_POLLS = 150;

function isLive(r: RunRecord): boolean {
  if (r.status !== "running") return false;
  const started = new Date(r.startedAt).getTime();
  return Number.isNaN(started) || Date.now() - started < STALE_RUN_MS;
}

/** What the list shows once the poll gives up: the record, no longer treated as live. */
function markStale(r: RunRecord): RunRecord {
  return r.status === "running" ? { ...r, status: "stopped", error: "Not heard from again" } : r;
}

/**
 * Enhance one card with AI.
 *
 * Reuses the same run and review path as synthesis rather than getting a shortcut of its
 * own: the output still arrives as a proposal, still shows its grounding, still needs an
 * explicit accept, and is still snapshotted before it lands. An "improve this" button
 * that writes directly would be the one place the whole design leaks.
 *
 * ## What persists
 *
 * A finished enhancement is on disk whether or not this component is mounted. On mount
 * the card's runs are read back; a ready, unapplied one is offered again as the review, so
 * closing the drawer never costs a second model run. `showing` is state set ONCE from that
 * first read, the way the brief page's panel is seeded - never derived from the refetched
 * list, because the refetch after an apply finds nothing pending and would unmount the
 * review in the very tick it reports "Applied". A run still in progress (the drawer was
 * closed mid-run; the process kept going) is polled until it finishes.
 */
export function EnhanceCard({
  slug,
  cardId,
  onApplied,
}: {
  slug: string;
  cardId: number;
  onApplied: () => void;
}) {
  const run = useRun(slug);
  const [showing, setShowing] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const seeded = useRef(false);

  const busy = run.phase === "running";
  const reviewRunId = run.phase === "ready" ? run.runId : showing;
  /*
   * A record can be left at "running" forever - the server died mid-run, the box slept -
   * and nothing rewrites it. The lock file has a 30-minute stale rule; the same age bounds
   * this, or one dead record would disable Enhance for the card for good and poll a
   * directory scan every four seconds for as long as the drawer stayed open.
   */
  const anyRunning = (runs ?? []).some(isLive);
  const polls = useRef(0);
  const notConnected = account?.state === "signed-out" || account?.state === "missing";

  const fetchRuns = useCallback(async (): Promise<RunRecord[] | null> => {
    const res = await fetch(
      `/api/ai/runs?slug=${encodeURIComponent(slug)}&cardId=${encodeURIComponent(String(cardId))}`,
    );
    if (!res.ok) return null;
    return ((await res.json()) as { runs: RunRecord[] }).runs;
  }, [slug, cardId]);

  // The open: the card's runs, and the review seed - set once, here.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await fetchRuns().catch(() => null);
      if (cancelled || !list) return;
      setRuns(list);
      if (!seeded.current) {
        seeded.current = true;
        const pending = list.find((r) => r.status === "ready" && !r.appliedAt);
        if (pending) setShowing(pending.runId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRuns]);

  // Whether the CLI is signed in. Served from a one-minute cache, so this is cheap.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/account");
        if (!res.ok) return;
        const data = (await res.json()) as { account: AccountStatus };
        if (!cancelled) setAccount(data.account);
      } catch {
        /* the run itself will say what is wrong */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A run that is still going (started from a drawer since closed) is watched to its end -
  // for a bounded while. Past that, the record is treated as stale and the button comes back.
  useEffect(() => {
    if (!anyRunning) return;
    polls.current = 0;
    const timer = setInterval(() => {
      polls.current += 1;
      if (polls.current > MAX_POLLS) {
        clearInterval(timer);
        setRuns((list) => (list ? list.map(markStale) : list));
        return;
      }
      void (async () => {
        const list = await fetchRuns().catch(() => null);
        if (!list) return;
        setRuns(list);
        if (list.some(isLive)) return;
        const pending = list.find((r) => r.status === "ready" && !r.appliedAt);
        if (pending) setShowing((s) => s ?? pending.runId);
      })();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, fetchRuns]);

  // A run this component started has ended: the history should say so.
  useEffect(() => {
    if (run.phase !== "ready" && run.phase !== "failed") return;
    void (async () => {
      const list = await fetchRuns().catch(() => null);
      if (list) setRuns(list);
    })();
  }, [run.phase, fetchRuns]);

  async function start() {
    setShowing(null);
    await run.start("enhance-card", cardId);
  }

  const label = busy ? "Enhancing..." : reviewRunId ? "Run again" : "Enhance with AI";

  return (
    <div className="stack" style={{ gap: 10 }} data-testid="enhance-panel">
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="button"
          disabled={busy || anyRunning || notConnected}
          onClick={() => void start()}
          data-testid="enhance"
        >
          {label}
        </button>
        {busy && (
          <span className="mono faint" data-testid="enhance-status">
            running
          </span>
        )}
        {!busy && anyRunning && (
          <span className="mono faint" data-testid="enhance-status">
            a run is in progress
          </span>
        )}
      </div>

      {notConnected && (
        <Notice data-testid="account-notice">
          Claude is not connected, so AI runs will fail.{" "}
          <Link href="/settings" className="link-button">
            Open Settings
          </Link>
        </Notice>
      )}

      {run.steps.length > 0 && (
        <ol className="steps mono" data-testid="enhance-steps">
          {run.steps.map((s, i) => (
            <li key={`${i}-${s}`}>{s}</li>
          ))}
        </ol>
      )}

      {run.phase === "failed" && (
        <Notice data-testid="enhance-error">{run.error}</Notice>
      )}

      {/*
        The review stays mounted after applying. Resetting the run or closing the pane
        here would unmount the component that reports what just happened — the user
        would see the work vanish with no confirmation that it landed.
      */}
      {reviewRunId && (
        <ProposalReview
          key={reviewRunId}
          slug={slug}
          runId={reviewRunId}
          onApplied={() => {
            onApplied();
            void fetchRuns()
              .then((list) => {
                if (list) setRuns(list);
              })
              .catch(() => undefined);
          }}
        />
      )}

      {runs && runs.length > 0 && <EnhanceHistory runs={runs} />}
    </div>
  );
}

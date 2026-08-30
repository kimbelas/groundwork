"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Notice } from "@/components/ui/Notice";

import { ProposalReview } from "./ProposalReview";
import { RevertButton } from "./RevertButton";
import { useRun } from "./useRun";

import type { AccountStatus } from "@/lib/ai/account";

/** How often the adopted run's record is re-read. Slow enough to be free, fast enough
 *  that the review appears while you are still looking at the page. */
const POLL_MS = 3_000;

export interface ActiveRun {
  runId: string;
  /** ISO, from the run record. Used only to show elapsed time. */
  startedAt: string;
}

function elapsed(startedAt: string, now: number): string {
  const ms = now - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/**
 * The synthesis entry point: start a run, watch it work, then read the proposal.
 *
 * `pendingRunId` lets a proposal that finished while the tab was closed be picked up on
 * the next load — the run is on disk either way, so the UI should not be the thing that
 * loses it. It is a project-level run by construction: a card's enhancement is offered
 * from the card, not here.
 *
 * ## Adopting a run this tab did not start
 *
 * The run deliberately outlives the response that started it, so closing a tab cannot kill
 * a three-minute synthesis. The cost of that design was paid here: switching tabs unmounted
 * this panel, `useRun` aborted its stream, and the work carried on with **nothing on screen
 * saying so**. Coming back, `pendingRunFor` returned null — the run is not ready — so the
 * page showed idle buttons over a project that was still locked, and the next click failed
 * with a lock conflict for reasons the user could not see.
 *
 * `activeRun` closes that. The server finds the in-flight run at render time and this panel
 * adopts it: buttons stay disabled, elapsed time keeps counting, and when the record turns
 * `ready` the review opens by itself.
 *
 * What an adopted run cannot show is the step list. Steps are streamed, not stored, and the
 * stream belongs to the tab that started it. Elapsed time is the substitute, chosen because
 * it answers the same question the step list exists to answer — *is this working or is it
 * hung* — which a bare spinner does not.
 */
export function AiPanel({
  slug,
  briefEmpty,
  pendingRunId,
  activeRun = null,
}: {
  slug: string;
  briefEmpty: boolean;
  pendingRunId: string | null;
  activeRun?: ActiveRun | null;
}) {
  const run = useRun(slug);
  const [showing, setShowing] = useState<string | null>(pendingRunId);
  /** Bumped after an apply so the revert control re-checks availability. */
  const [nonce, setNonce] = useState(0);
  const [account, setAccount] = useState<AccountStatus | null>(null);

  /*
   * What polling learned, as an override keyed by run id — never a copy of `activeRun`.
   *
   * `useState(serverValue)` ignores a changed initial value, so a component seeded from a
   * prop freezes at first render and no `router.refresh()` ever reaches it. That rule is in
   * CLAUDE.md because it has bitten this codebase before; holding the *finished* ids and
   * deriving the rendered value is the shape that does not.
   */
  const [settled, setSettled] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());

  // The run this page found already in flight, until we see it finish.
  const adopted = activeRun && !settled[activeRun.runId] ? activeRun : null;
  const adoptedId = adopted?.runId ?? null;
  const adoptedOutcome = activeRun ? settled[activeRun.runId] : undefined;

  const busy = run.phase === "running" || adopted !== null;
  const reviewRunId = run.phase === "ready" ? run.runId : showing;
  const notConnected = account?.state === "signed-out" || account?.state === "missing";

  // Whether the CLI is signed in, from a one-minute server cache. A run that would fail
  // for want of an account should say so before it is started, not after a minute of steps.
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

  /*
   * Watch the adopted run's record until it stops saying `running`.
   *
   * Keyed on the id rather than the object, because `adopted` is derived and gets a new
   * identity every render — depending on it would tear down and rebuild the interval on
   * each tick, which is how a poll becomes a hot loop.
   */
  useEffect(() => {
    if (adoptedId === null) return;
    let cancelled = false;

    const check = async () => {
      try {
        const params = new URLSearchParams({ slug, runId: adoptedId });
        const res = await fetch(`/api/ai/runs?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { run: { status: string } | null };
        if (cancelled) return;

        // A missing record settles the run too. Otherwise a deleted run directory would
        // leave the panel disabled forever with no way back.
        const status = data.run?.status ?? "gone";
        if (status === "running") return;

        setSettled((s) => ({ ...s, [adoptedId]: status }));
        // Open the review directly rather than waiting for a refresh: `showing` is seeded
        // once from a prop and a re-render would not move it.
        if (status === "ready") setShowing(adoptedId);
      } catch {
        /* transient; the next tick asks again */
      }
    };

    const tick = setInterval(() => void check(), POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    void check();

    return () => {
      cancelled = true;
      clearInterval(tick);
      clearInterval(clock);
    };
  }, [adoptedId, slug]);

  async function start(job: "synthesize" | "critique") {
    setShowing(null);
    await run.start(job);
  }

  return (
    <section className="ai-panel" data-testid="ai-panel">
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="button"
          disabled={busy || briefEmpty || notConnected}
          onClick={() => void start("synthesize")}
          data-testid="synthesize"
        >
          Synthesize
        </button>

        <button
          type="button"
          className="button"
          disabled={busy || notConnected}
          onClick={() => void start("critique")}
          data-testid="critique"
        >
          Critique
        </button>

        {briefEmpty && <span className="body-sm faint">Write the brief first.</span>}

        {busy && (
          <span className="mono faint" data-testid="run-status">
            {adopted ? `running · ${elapsed(adopted.startedAt, now)}` : "running"}
          </span>
        )}

        <RevertButton slug={slug} nonce={nonce} />
      </div>

      {notConnected && (
        <Notice data-testid="account-notice">
          Claude is not connected, so AI runs will fail.{" "}
          <Link href="/settings" className="link-button">
            Open Settings
          </Link>
        </Notice>
      )}

      {adopted && (
        <p className="body-sm soft" data-testid="run-adopted">
          A run started earlier is still working on this project. It keeps going whether or
          not this page is open; the review appears here when it finishes.
        </p>
      )}

      {adoptedOutcome === "failed" && (
        <Notice data-testid="run-adopted-failed">
          The run that was in progress failed. Start another when you are ready.
        </Notice>
      )}
      {adoptedOutcome === "stopped" && (
        <Notice data-testid="run-adopted-stopped">
          The run that was in progress was stopped.
        </Notice>
      )}

      {run.steps.length > 0 && (
        <ol className="steps mono" data-testid="run-steps">
          {run.steps.map((s, i) => (
            <li key={`${i}-${s}`}>{s}</li>
          ))}
        </ol>
      )}

      {run.phase === "failed" && <Notice data-testid="run-error">{run.error}</Notice>}

      {reviewRunId !== null && (
        <ProposalReview
          key={reviewRunId}
          slug={slug}
          runId={reviewRunId}
          onApplied={() => setNonce((n) => n + 1)}
        />
      )}
    </section>
  );
}

"use client";

import { useState } from "react";

import { ProposalReview } from "./ProposalReview";
import { RevertButton } from "./RevertButton";
import { useRun } from "./useRun";

/**
 * The synthesis entry point: start a run, watch it work, then read the proposal.
 *
 * `pendingRunId` lets a proposal that finished while the tab was closed be picked up on
 * the next load — the run is on disk either way, so the UI should not be the thing that
 * loses it.
 */
export function AiPanel({
  slug,
  briefEmpty,
  pendingRunId,
}: {
  slug: string;
  briefEmpty: boolean;
  pendingRunId: string | null;
}) {
  const run = useRun(slug);
  const [showing, setShowing] = useState<string | null>(pendingRunId);
  /** Bumped after an apply so the revert control re-checks availability. */
  const [nonce, setNonce] = useState(0);

  const busy = run.phase === "running";
  const reviewRunId = run.phase === "ready" ? run.runId : showing;

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
          disabled={busy || briefEmpty}
          onClick={() => void start("synthesize")}
          data-testid="synthesize"
        >
          Synthesize
        </button>

        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void start("critique")}
          data-testid="critique"
        >
          Critique
        </button>

        {briefEmpty && <span className="body-sm faint">Write the brief first.</span>}

        {busy && (
          <span className="mono faint" data-testid="run-status">
            running
          </span>
        )}

        <RevertButton slug={slug} nonce={nonce} />
      </div>

      {run.steps.length > 0 && (
        <ol className="steps mono" data-testid="run-steps">
          {run.steps.map((s, i) => (
            <li key={`${i}-${s}`}>{s}</li>
          ))}
        </ol>
      )}

      {run.phase === "failed" && (
        <div className="notice body-sm" role="alert" data-testid="run-error">
          {run.error}
        </div>
      )}

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

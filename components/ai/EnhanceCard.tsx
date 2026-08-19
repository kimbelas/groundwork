"use client";

import { ProposalReview } from "./ProposalReview";
import { useRun } from "./useRun";

/**
 * Enhance one card with AI.
 *
 * Reuses the same run and review path as synthesis rather than getting a shortcut of its
 * own: the output still arrives as a proposal, still shows its grounding, still needs an
 * explicit accept, and is still snapshotted before it lands. An "improve this" button
 * that writes directly would be the one place the whole design leaks.
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
  const busy = run.phase === "running";

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void run.start("enhance-card", cardId)}
          data-testid="enhance"
        >
          {busy ? "Enhancing..." : "Enhance with AI"}
        </button>
        {busy && (
          <span className="mono faint" data-testid="enhance-status">
            running
          </span>
        )}
      </div>

      {run.steps.length > 0 && (
        <ol className="steps mono" data-testid="enhance-steps">
          {run.steps.map((s, i) => (
            <li key={`${i}-${s}`}>{s}</li>
          ))}
        </ol>
      )}

      {run.phase === "failed" && (
        <div className="notice body-sm" role="alert" data-testid="enhance-error">
          {run.error}
        </div>
      )}

      {/*
        The review stays mounted after applying. Resetting the run or closing the pane
        here would unmount the component that reports what just happened — the user
        would see the work vanish with no confirmation that it landed.
      */}
      {run.phase === "ready" && run.runId && (
        <ProposalReview key={run.runId} slug={slug} runId={run.runId} onApplied={onApplied} />
      )}
    </div>
  );
}

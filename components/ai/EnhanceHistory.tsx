"use client";

import { useEffect, useState } from "react";

import { confidenceLabel, priorityLabel, sizeLabel } from "@/lib/labels";

import { RepoContextNote } from "./ProposalReview";

import type { Proposal, RunRecord } from "@/lib/ai/types";

/**
 * Every enhancement this card has had, newest first, each openable to what was proposed.
 *
 * Deliberately NOT the review component. The review diffs a proposal against the card as
 * it is now, which is exactly right before accepting and exactly wrong afterwards: an
 * applied run would read "description unchanged, every criterion kept", a false record.
 * History shows the proposal itself - summary, the proposed card, its criteria - and the
 * run's outcome. Prose is text nodes; nothing here becomes HTML.
 */
export function EnhanceHistory({ runs }: { runs: RunRecord[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="history" data-testid="enhance-history">
      <p className="label">Enhancements ({runs.length})</p>
      <ul className="history-list">
        {runs.map((r) => (
          <li
            key={r.runId}
            className="history-row"
            data-testid="enhance-run"
            data-status={r.appliedAt ? "applied" : r.status}
          >
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="mono faint">{formatWhen(r.startedAt)}</span>
              <span className="body-sm">{outcome(r)}</span>
              {r.status === "ready" && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setOpen(open === r.runId ? null : r.runId)}
                  data-testid="enhance-view"
                >
                  {open === r.runId ? "hide" : "view"}
                </button>
              )}
            </div>
            {open === r.runId && <ProposalSummary runId={r.runId} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function outcome(r: RunRecord): string {
  if (r.appliedAt) return `Applied ${formatWhen(r.appliedAt)}`;
  switch (r.status) {
    case "ready":
      return "Not applied";
    case "running":
      return "Running";
    case "failed":
      return `Failed: ${r.error ?? "no reason recorded"}`;
    case "stopped":
      return "Stopped";
  }
}

/** Rendered only after a client fetch, so the browser's locale is the right one to use. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

interface SummaryPayload {
  run: RunRecord | null;
  ok?: boolean;
  proposal?: Proposal;
  error?: string;
}

function ProposalSummary({ runId }: { runId: string }) {
  const [data, setData] = useState<SummaryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/ai/proposal?runId=${encodeURIComponent(runId)}`);
        if (!res.ok) throw new Error(`Could not load the proposal (${res.status})`);
        const payload = (await res.json()) as SummaryPayload;
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) return <p className="body-sm faint">{error}</p>;
  if (!data) return <p className="body-sm faint">Loading...</p>;
  if (!data.run) return null;
  if (data.ok === false || !data.proposal) {
    return <p className="body-sm faint">The run produced nothing usable. {data.error}</p>;
  }

  const proposal = data.proposal;
  const card = proposal.cards[0];

  return (
    <div className="stack history-proposal" data-testid="enhance-proposal">
      <RepoContextNote run={data.run} />
      <p className="body-sm" style={{ margin: 0 }}>
        {proposal.summary}
      </p>
      {card && (
        <>
          <p className="body-sm" style={{ margin: 0 }}>
            <strong>{card.title}</strong>{" "}
            <span className="mono faint">
              {priorityLabel(card.priority)} · {sizeLabel(card.size)} ·{" "}
              {confidenceLabel(card.confidence)}
            </span>
          </p>
          {card.body && (
            <p className="body-sm soft" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
              {card.body}
            </p>
          )}
          {card.acceptance.length > 0 && (
            <ul className="sub-list body-sm soft">
              {card.acceptance.map((a, i) => (
                <li key={`${i}-${a}`}>{a}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {proposal.questions.length > 0 && (
        <ul className="sub-list body-sm soft">
          {proposal.questions.map((q, i) => (
            <li key={`${i}-${q.text}`}>
              <span className="mono faint">question </span>
              {q.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

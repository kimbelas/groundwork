"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { likelihoodLabel } from "@/lib/labels";

import type {
  CodeGroundingResult,
  GroundingReport,
  GroundingResult,
} from "@/lib/ai/grounding";
import type { Proposal, RunRecord } from "@/lib/ai/types";

interface ProposalPayload {
  run: RunRecord | null;
  ok?: boolean;
  proposal?: Proposal;
  grounding?: GroundingReport;
  warnings?: string[];
  error?: string;
  raw?: string;
}

type Kind = "cards" | "phases" | "risks" | "assumptions" | "questions";

type Selection = Record<Kind, Set<number>>;

const KINDS: Kind[] = ["cards", "phases", "risks", "assumptions", "questions"];

function selectAll(proposal: Proposal): Selection {
  return {
    cards: new Set(proposal.cards.map((_, i) => i)),
    phases: new Set(proposal.phases.map((_, i) => i)),
    risks: new Set(proposal.risks.map((_, i) => i)),
    assumptions: new Set(proposal.assumptions.map((_, i) => i)),
    questions: new Set(proposal.questions.map((_, i) => i)),
  };
}

/**
 * The diff.
 *
 * Every block accepts or rejects on its own. Accept-all exists, but per-block is the
 * default posture — a single Apply button is how other tools quietly overwrite your
 * work, and the whole point of this stage is that the model proposes and you decide.
 */
export function ProposalReview({
  slug,
  runId,
  onApplied,
}: {
  slug: string;
  runId: string | null;
  onApplied?: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<ProposalPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const params = new URLSearchParams(runId ? { runId } : { slug });
        const res = await fetch(`/api/ai/proposal?${params.toString()}`);
        if (!res.ok) {
          const detail = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(detail.error ?? `Could not load the proposal (${res.status})`);
        }
        const payload = (await res.json()) as ProposalPayload;
        if (cancelled) return;
        setData(payload);
        if (payload.proposal) setSelection(selectAll(payload.proposal));
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, runId]);

  const toggle = useCallback((kind: Kind, index: number) => {
    setSelection((prev) => {
      if (!prev) return prev;
      const next: Selection = { ...prev, [kind]: new Set(prev[kind]) };
      if (next[kind].has(index)) next[kind].delete(index);
      else next[kind].add(index);
      return next;
    });
  }, []);

  const acceptedCount = useMemo(
    () => (selection ? KINDS.reduce((n, k) => n + selection[k].size, 0) : 0),
    [selection],
  );

  const offeredCount = useMemo(() => {
    const p = data?.proposal;
    if (!p) return 0;
    return (
      p.cards.length +
      p.phases.length +
      p.risks.length +
      p.assumptions.length +
      p.questions.length
    );
  }, [data]);

  async function apply() {
    if (!data?.run || !selection) return;
    setApplying(true);
    setApplyError(null);

    try {
      const res = await fetch("/api/ai/proposal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: data.run.runId,
          selection: Object.fromEntries(KINDS.map((k) => [k, [...selection[k]]])),
        }),
      });

      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (payload ?? {}) as { error?: string };
        throw new Error(detail.error ?? `Apply failed (${res.status})`);
      }

      const result = payload as {
        touched: string[];
        commit: { ok: boolean; sha?: string; skipped?: string };
      };
      setApplied(
        result.commit.ok
          ? `Applied ${result.touched.length} file(s), committed ${result.commit.sha}.`
          : `Applied ${result.touched.length} file(s). Not committed: ${result.commit.skipped}.`,
      );
      onApplied?.();
      router.refresh();
    } catch (e) {
      setApplyError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  if (loadError) {
    return (
      <div className="notice body-sm" role="alert">
        {loadError}
      </div>
    );
  }

  if (!data) return <p className="body-sm faint">Loading the proposal...</p>;
  if (!data.run) return null;

  if (data.ok === false) {
    return (
      <section className="raised" style={{ padding: 14 }} data-testid="proposal-invalid">
        <p className="label" style={{ color: "var(--s-blocked)" }}>
          The run produced something unusable
        </p>
        <p className="body-sm">{data.error}</p>
        <p className="body-sm faint">
          Nothing was written. The raw output is below so you can see what happened.
        </p>
        {data.raw && <pre className="raw-output mono scroll-x">{data.raw.slice(0, 4000)}</pre>}
      </section>
    );
  }

  const proposal = data.proposal;
  const grounding = data.grounding;
  if (!proposal || !selection) return null;

  if (applied) {
    return (
      <div className="notice body-sm" data-testid="apply-result">
        {applied}
      </div>
    );
  }

  return (
    <section className="stack" style={{ gap: 14 }} data-testid="proposal-review">
      <div className="raised" style={{ padding: 12 }}>
        <p className="label">Proposed</p>
        <p className="body-sm" style={{ margin: "4px 0 0" }}>
          {proposal.summary}
        </p>
      </div>

      <RepoContextNote run={data.run} />

      {(data.warnings ?? []).map((w) => (
        <div className="notice body-sm" key={w} data-testid="proposal-warning">
          {w}
        </div>
      ))}

      {proposal.phases.length > 0 && (
        <Block title={`Phases (${proposal.phases.length})`}>
          {proposal.phases.map((p, i) => (
            <Row
              key={p.n}
              checked={selection.phases.has(i)}
              onToggle={() => toggle("phases", i)}
              testId="proposal-phase"
            >
              <span className="mono faint">{p.n}</span> <strong>{p.name}</strong>
              {p.goal && <span className="soft"> — {p.goal}</span>}
            </Row>
          ))}
        </Block>
      )}

      {proposal.cards.length > 0 && (
        <Block title={`Cards (${proposal.cards.length})`}>
          {proposal.cards.map((c, i) => (
            <Row
              key={`${c.op}-${c.title}`}
              checked={selection.cards.has(i)}
              onToggle={() => toggle("cards", i)}
              testId="proposal-card"
            >
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="mono faint">{c.op}</span>
                <strong>{c.title}</strong>
                <span className="mono faint">
                  {c.priority} {c.size} {c.confidence.toFixed(1)}
                </span>
                <Grounding result={grounding?.cards[i]} />
                <CodeGrounding result={grounding?.code.cards[i]} />
              </div>
              <CodeCitation result={grounding?.code.cards[i]} />
              {c.acceptance.length > 0 && (
                <ul className="sub-list body-sm soft">
                  {c.acceptance.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </Row>
          ))}
        </Block>
      )}

      {proposal.questions.length > 0 && (
        <Block title={`Open questions (${proposal.questions.length})`}>
          {proposal.questions.map((q, i) => (
            <Row
              key={q.text}
              checked={selection.questions.has(i)}
              onToggle={() => toggle("questions", i)}
              testId="proposal-question"
            >
              {q.text}
              {q.blocks && <span className="mono faint"> blocks: {q.blocks}</span>}
            </Row>
          ))}
        </Block>
      )}

      {proposal.risks.length > 0 && (
        <Block title={`Risks (${proposal.risks.length})`}>
          {proposal.risks.map((r, i) => (
            <Row
              key={r.text}
              checked={selection.risks.has(i)}
              onToggle={() => toggle("risks", i)}
              testId="proposal-risk"
            >
              {r.text}{" "}
              <span className="mono faint">
                {likelihoodLabel(r.likelihood)} / {likelihoodLabel(r.impact)}
              </span>{" "}
              <Grounding result={grounding?.risks[i]} />
              <CodeGrounding result={grounding?.code.risks[i]} />
              <CodeCitation result={grounding?.code.risks[i]} />
            </Row>
          ))}
        </Block>
      )}

      {proposal.assumptions.length > 0 && (
        <Block title={`Assumptions (${proposal.assumptions.length})`}>
          {proposal.assumptions.map((a, i) => (
            <Row
              key={a.text}
              checked={selection.assumptions.has(i)}
              onToggle={() => toggle("assumptions", i)}
              testId="proposal-assumption"
            >
              {a.text} <Grounding result={grounding?.assumptions[i]} />
              <CodeGrounding result={grounding?.code.assumptions[i]} />
              <CodeCitation result={grounding?.code.assumptions[i]} />
            </Row>
          ))}
        </Block>
      )}

      {applyError && (
        <div className="notice body-sm" role="alert" data-testid="apply-error">
          {applyError}
        </div>
      )}

      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="button"
          disabled={applying || acceptedCount === 0}
          onClick={() => void apply()}
          data-testid="apply"
        >
          {applying ? "Applying..." : `Apply ${acceptedCount} of ${offeredCount}`}
        </button>

        <button
          type="button"
          className="link-button mono"
          disabled={applying}
          onClick={() => setSelection(selectAll(proposal))}
        >
          select all
        </button>

        <button
          type="button"
          className="link-button mono"
          disabled={applying}
          onClick={() =>
            setSelection({
              cards: new Set(),
              phases: new Set(),
              risks: new Set(),
              assumptions: new Set(),
              questions: new Set(),
            })
          }
        >
          select none
        </button>

        <span className="mono faint">A snapshot is taken before anything is written.</span>
      </div>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="raised" style={{ padding: 12 }}>
      <p className="label" style={{ marginBottom: 8 }}>
        {title}
      </p>
      <ul className="proposal-list body-sm">{children}</ul>
    </section>
  );
}

function Row({
  checked,
  onToggle,
  testId,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <li data-testid={testId} data-accepted={checked ? "true" : "false"}>
      <label className="proposal-row">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className={checked ? undefined : "faint"}>{children}</span>
      </label>
    </li>
  );
}

/**
 * What the repository contributed, stated on the review itself.
 *
 * The one thing this must never do is stay quiet. A reader who believes the plan was
 * checked against their code when it was not will trust it further than they should — and
 * keyword-only retrieval, a stale index and no repository at all are three different
 * situations with three different fixes. Shown for a healthy run too, because "read 6
 * excerpts" is the sentence that makes the citations below make sense.
 */
function RepoContextNote({ run }: { run: RunRecord }) {
  const ctx = run.repoContext;
  if (!ctx) return null;

  const summary =
    ctx.status === "included"
      ? `Read ${ctx.excerpts} excerpt${ctx.excerpts === 1 ? "" : "s"} of the connected ` +
        `repository, ranked ${ctx.semantic ? "by meaning and by term" : "by term"}.`
      : null;

  return (
    <div className="notice body-sm" data-testid="repo-context" data-repo-context={ctx.status}>
      {summary}
      {summary && ctx.reason ? " " : null}
      {ctx.reason}
    </div>
  );
}

/**
 * Whether a claim about the code checks out, as its own chip.
 *
 * Deliberately not merged with the brief-grounding chip. The two answer different
 * questions — "is this what I asked for" and "is this what my code does" — and a reader who
 * trusts a wrong code citation goes and edits the wrong file. A claim citing no code shows
 * nothing at all, because most claims are about the plan and a row of "n/a" chips would bury
 * the two that matter.
 */
function CodeGrounding({ result }: { result: CodeGroundingResult | undefined }) {
  if (!result || result.status === "none") return null;

  if (result.status === "quoted") {
    return (
      <span className="chip chip-done" data-code-grounding="quoted">
        in the code
      </span>
    );
  }
  if (result.status === "inferred") {
    return (
      <span className="chip chip-paused" data-code-grounding="inferred">
        not in the excerpts
      </span>
    );
  }
  return (
    <span
      className="chip chip-blocked"
      title="This code is not in the excerpts this run was given."
      data-code-grounding="ungrounded"
    >
      unverified citation
    </span>
  );
}

/**
 * The citation itself: where it points, and the bytes it claims are there.
 *
 * Shown rather than tucked into a tooltip because it is the evidence the reader is being
 * asked to judge, and a `title` cannot be read on a touch screen. Rendered as text nodes —
 * the quote comes from a model via a JSON file and never becomes markup.
 */
function CodeCitation({ result }: { result: CodeGroundingResult | undefined }) {
  if (!result || result.cite === null) return null;

  return (
    <div className="code-cite body-sm" data-testid="code-citation">
      <span className="mono faint">{result.cite}</span>
      {result.quote && <code className="code-cite-quote mono">{result.quote}</code>}
    </div>
  );
}

/** The grounding badge is the fastest read on whether a claim came from the brief. */
function Grounding({ result }: { result: GroundingResult | undefined }) {
  if (!result) return null;

  if (result.status === "quoted") {
    return (
      <span className="chip chip-done" title={result.quote ?? ""} data-grounding="quoted">
        quoted
      </span>
    );
  }
  if (result.status === "inferred") {
    return (
      <span className="chip chip-paused" data-grounding="inferred">
        inferred
      </span>
    );
  }
  return (
    <span
      className="chip chip-blocked"
      title={`Not found in the brief: ${result.quote ?? ""}`}
      data-grounding="ungrounded"
    >
      ungrounded
    </span>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { runAskedLabel } from "@/lib/labels";

import { useAnswerSuggestions } from "./useAnswerSuggestions";

import type { Question } from "@/lib/schema";

/**
 * The Open Questions queue.
 *
 * This is the mechanism that makes the plan get better: an answer becomes a confirmed
 * fact fed into every later run, so the model works from more truth rather than a better
 * guess. That is why answering is a first-class view and not a field on a card.
 */
export function QuestionsList({
  slug,
  initial,
  initialMtimeMs,
  activeRunId = null,
  readyRunId = null,
}: {
  slug: string;
  initial: Question[];
  initialMtimeMs: number;
  /** A `suggest-answers` run still working, found on the server at render time. */
  activeRunId?: string | null;
  /** One that finished earlier — its options are still on disk and worth offering. */
  readyRunId?: string | null;
}) {
  const router = useRouter();
  const openIds = useMemo(
    () => initial.filter((q) => q.status === "open").map((q) => q.id),
    [initial],
  );
  const suggestions = useAnswerSuggestions(slug, activeRunId, readyRunId, openIds);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The server list is the source of truth; this holds only saved-but-not-yet-refreshed
   * answers. Copying `initial` into state would freeze the queue at first render, so a
   * synthesis run that added questions would never appear without a full reload.
   */
  const [saved, setSaved] = useState<ReadonlyMap<string, Question>>(new Map());

  const questions = useMemo(() => {
    const merged = initial.map((q) => saved.get(q.id) ?? q);
    // A question saved before the refresh landed but already reflected upstream needs
    // no override; comparing by status and answer keeps the map from growing.
    return merged;
  }, [initial, saved]);

  // One shared baseline for questions.md, advanced by each successful write — the same
  // reason ProjectDocProvider exists for project.md.
  const mtimeRef = useRef(initialMtimeMs);

  const save = useCallback(
    async (id: string, answer: string | null) => {
      setBusy(id);
      setError(null);

      try {
        const res = await fetch("/api/questions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug, id, answer, expectedMtimeMs: mtimeRef.current }),
        });

        const payload: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const detail = (payload ?? {}) as { error?: string };
          throw new Error(detail.error ?? `Could not save (${res.status})`);
        }

        const ok = payload as { mtimeMs: number; question: Question };
        mtimeRef.current = ok.mtimeMs;
        setSaved((prev) => new Map(prev).set(id, ok.question));
        setDrafts((d) => {
          const next = { ...d };
          delete next[id];
          return next;
        });
        // The unanswered count badges the rail, the tabs and the dashboard.
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [router, slug],
  );

  const open = questions.filter((q) => q.status === "open");
  const answered = questions.filter((q) => q.status === "answered");

  if (questions.length === 0) {
    // Carries the same test id as the populated view: this is still the questions
    // screen, and "which view am I on" should not depend on whether it has content.
    return (
      <div className="empty" data-testid="questions-list">
        <p className="display-sm" style={{ margin: "0 0 6px" }}>
          No open questions
        </p>
        <p className="body-sm" style={{ margin: 0 }}>
          Synthesis and critique add questions here when the brief does not settle
          something.
        </p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: "var(--space-5)" }} data-testid="questions-list">
      {error && (
        <div className="notice body-sm" role="alert" data-testid="questions-error">
          {error}
        </div>
      )}

      <section>
        <div className="row question-head">
          <p className="label">Open ({open.length})</p>
          {/*
            No button. The run starts on arrival - a question with no options is a question
            you answer from a blank box, which is the thing this removes, so putting it
            behind a click withheld the help exactly when it was most useful.
          */}
          {suggestions.running && (
            <span className="body-sm faint" data-testid="suggestions-running">
              Drafting answers...
            </span>
          )}
        </div>

        {suggestions.error && (
          <div className="notice body-sm" role="alert" data-testid="suggestions-error">
            {suggestions.error}
          </div>
        )}

        {suggestions.summary && (
          <p className="body-sm soft" data-testid="suggestions-summary">
            {suggestions.summary}
          </p>
        )}
        {open.length === 0 ? (
          <p className="body-sm faint">Everything asked so far has been answered.</p>
        ) : (
          <ul className="question-list">
            {open.map((q) => (
              <li key={q.id} className="question" data-testid={`question-${q.id}`}>
                <p className="question-text">{q.text}</p>

                {(suggestions.byQuestion.get(q.id) ?? []).length > 0 && (
                  <ul className="answer-options" data-testid={`options-${q.id}`}>
                    {(suggestions.byQuestion.get(q.id) ?? []).map((opt, i) => {
                      const chosen = (drafts[q.id] ?? "") === opt.text;
                      return (
                        <li key={`${q.id}-${i}`}>
                          <button
                            type="button"
                            className={`answer-option${chosen ? " answer-option-chosen" : ""}`}
                            aria-pressed={chosen}
                            disabled={busy === q.id}
                            /*
                              Fills the box rather than saving. The answer is stored as a
                              confirmed fact given to every later run, so the last edit before
                              it becomes one should be the user's - and a one-click store makes
                              a misread option permanent.
                            */
                            onClick={() => setDrafts((d) => ({ ...d, [q.id]: opt.text }))}
                            data-testid={`option-${q.id}-${i}`}
                          >
                            <span className="answer-option-head">
                              <span className="answer-option-text">{opt.text}</span>
                              {opt.recommended && (
                                <span
                                  className="chip chip-active answer-option-pill"
                                  data-testid={`recommended-${q.id}`}
                                >
                                  Recommended
                                </span>
                              )}
                            </span>
                            {opt.because && (
                              <span className="answer-option-why body-sm">{opt.because}</span>
                            )}
                            <span className="answer-option-source body-sm">
                              {opt.groundedIn ? "Quoted from the brief" : "Inferred, not stated"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <textarea
                  className="input"
                  rows={2}
                  aria-label={`Answer: ${q.text}`}
                  placeholder={
                    (suggestions.byQuestion.get(q.id) ?? []).length > 0
                      ? "Or write your own answer."
                      : "Answer it, or leave it open."
                  }
                  value={drafts[q.id] ?? ""}
                  disabled={busy === q.id}
                  onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                />
                <div className="row" style={{ gap: 10 }}>
                  <button
                    type="button"
                    className="button"
                    disabled={busy === q.id || !(drafts[q.id] ?? "").trim()}
                    onClick={() => void save(q.id, drafts[q.id] ?? "")}
                    data-testid={`answer-${q.id}`}
                  >
                    {busy === q.id ? "Saving..." : "Answer"}
                  </button>
                  {q.fromRun && (
                    /*
                      The run id in the tooltip, a date on screen. It is not interactive and
                      not actionable - it was competing for attention with the answer box.
                    */
                    <span className="body-sm faint" title={q.fromRun}>
                      {runAskedLabel(q.fromRun) ?? "Asked by an AI run"}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {answered.length > 0 && (
        <section>
          <p className="label">Answered ({answered.length})</p>
          <ul className="question-list">
            {answered.map((q) => (
              <li key={q.id} className="question" data-testid={`question-${q.id}`}>
                <p className="question-text faint">{q.text}</p>
                <p className="body-sm" data-testid={`answer-text-${q.id}`}>
                  {q.answer}
                </p>
                <button
                  type="button"
                  className="link-button mono"
                  disabled={busy === q.id}
                  onClick={() => void save(q.id, null)}
                  data-testid={`reopen-${q.id}`}
                >
                  reopen
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="body-sm faint">
        Answered questions are given to every later run as confirmed facts.
      </p>
    </div>
  );
}

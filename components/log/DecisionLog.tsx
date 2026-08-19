"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Prose } from "@/components/ui/Prose";
import type { LogEntry } from "@/lib/log";

/**
 * The decision log: what was decided, what else was on the table, and why.
 *
 * Entries can be added but never edited from the app. Three months on, the value of
 * this file is that it says what was thought *at the time* — and something you can
 * quietly revise cannot carry that.
 */
export function DecisionLog({ slug, entries }: { slug: string; entries: LogEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [considered, setConsidered] = useState("");
  const [because, setBecause] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, title, considered, because }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `Could not save (${res.status})`);
      }

      setTitle("");
      setConsidered("");
      setBecause("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" style={{ gap: 16 }} data-testid="decision-log">
      <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
        <span className="label">Decision log ({entries.length})</span>
        {!open && (
          <button
            type="button"
            className="button"
            onClick={() => setOpen(true)}
            data-testid="add-decision"
          >
            Record a decision
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="raised decision-form" data-testid="decision-form">
          <label className="stack" style={{ gap: 4 }}>
            <span className="label">What was decided</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Keep the 2014 system, integrate rather than replace"
              aria-label="What was decided"
              autoFocus
            />
          </label>

          <label className="stack" style={{ gap: 4 }}>
            <span className="label">What else was considered</span>
            <textarea
              className="input"
              rows={2}
              value={considered}
              onChange={(e) => setConsidered(e.target.value)}
              placeholder="replacing it; a thin sync layer; integrating directly"
              aria-label="What else was considered"
            />
          </label>

          <label className="stack" style={{ gap: 4 }}>
            <span className="label">Why</span>
            <textarea
              className="input"
              rows={2}
              value={because}
              onChange={(e) => setBecause(e.target.value)}
              placeholder="The reason that will not be obvious in three months."
              aria-label="Why"
            />
          </label>

          {error && (
            <div className="notice body-sm" role="alert" data-testid="decision-error">
              {error}
            </div>
          )}

          <div className="row" style={{ gap: 10 }}>
            <button type="submit" className="button" disabled={busy || !title.trim()}>
              {busy ? "Saving..." : "Record"}
            </button>
            <button
              type="button"
              className="link-button mono"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              cancel
            </button>
            <span className="mono faint">Dated today. Entries are never edited.</span>
          </div>
        </form>
      )}

      {entries.length === 0 ? (
        <div className="empty">
          <p className="display-sm" style={{ margin: "0 0 6px" }}>
            Nothing recorded yet
          </p>
          <p className="body-sm" style={{ margin: 0 }}>
            The first time you choose one approach over another, write down why.
          </p>
        </div>
      ) : (
        <ol className="log-list">
          {entries.map((entry, i) => (
            <li key={`${entry.date}-${entry.title}-${i}`} className="log-entry">
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <span className="mono faint">{entry.date ?? "undated"}</span>
                <strong>{entry.title}</strong>
              </div>
              {entry.body && <Prose text={entry.body} className="body-sm soft log-body" />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

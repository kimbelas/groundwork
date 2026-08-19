"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Add, rename, reorder and remove board columns.
 *
 * Columns are declared once in `project.md`, and cards reference them by name — so a
 * rename has to rewrite every affected card, and a removal has to be refused while any
 * card still points at it. Both of those rules live in the vault layer; this is only the
 * surface for them.
 */
export function ColumnManager({
  slug,
  columns,
  mtimeMs,
}: {
  slug: string;
  columns: string[];
  mtimeMs: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(columns);
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = draft.length !== columns.length || draft.some((c, i) => c !== columns[i]);

  function move(index: number, by: number) {
    const next = [...draft];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[target] = a;
    setDraft(next);
  }

  async function send(payload: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vault/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (data ?? {}) as { error?: string };
        throw new Error(detail.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    try {
      await send({ kind: "columns", columns: draft, expectedMtimeMs: mtimeMs });
      setOpen(false);
    } catch {
      // The message is already on screen; keep the panel open so it can be corrected.
    }
  }

  async function rename(from: string) {
    const to = window.prompt(`Rename "${from}" to:`, from)?.trim();
    if (!to || to === from) return;
    try {
      await send({ kind: "rename-column", from, to });
      setDraft((cols) => cols.map((c) => (c === from ? to : c)));
    } catch {
      /* reported above */
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="button"
        onClick={() => {
          setDraft(columns);
          setError(null);
          setOpen(true);
        }}
        data-testid="manage-columns"
      >
        Manage columns
      </button>
    );
  }

  return (
    <section className="raised column-manager" data-testid="column-manager">
      <p className="label">Columns</p>

      {error && (
        <div className="notice body-sm" role="alert" data-testid="columns-error">
          {error}
        </div>
      )}

      <ul className="column-list">
        {draft.map((name, i) => (
          <li key={name} data-testid={`column-row-${name}`}>
            <span className="column-row-name">{name}</span>
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="icon-button"
                disabled={busy || i === 0}
                aria-label={`Move ${name} earlier`}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={busy || i === draft.length - 1}
                aria-label={`Move ${name} later`}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => void rename(name)}
                data-testid={`rename-${name}`}
              >
                rename
              </button>
              <button
                type="button"
                className="link-button"
                disabled={busy || draft.length === 1}
                style={{ color: "var(--s-blocked)" }}
                aria-label={`Remove ${name}`}
                onClick={() => setDraft((cols) => cols.filter((c) => c !== name))}
                data-testid={`remove-${name}`}
              >
                remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form
        className="row"
        style={{ gap: 10, marginTop: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          const name = added.trim();
          if (!name) return;
          if (draft.some((c) => c.toLowerCase() === name.toLowerCase())) {
            setError(`There is already a column called "${name}".`);
            return;
          }
          setDraft((cols) => [...cols, name]);
          setAdded("");
          setError(null);
        }}
      >
        <input
          className="input"
          value={added}
          onChange={(e) => setAdded(e.target.value)}
          placeholder="New column name"
          aria-label="New column name"
          style={{ maxWidth: 260 }}
        />
        <button type="submit" className="button" disabled={busy || !added.trim()}>
          Add
        </button>
      </form>

      <div className="row" style={{ gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        <button
          type="button"
          className="button button-primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
          data-testid="save-columns"
        >
          {busy ? "Saving..." : "Save order"}
        </button>
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          done
        </button>
        <span className="body-sm faint">
          A rename updates every card in that column. A column holding cards cannot be
          removed.
        </span>
      </div>
    </section>
  );
}

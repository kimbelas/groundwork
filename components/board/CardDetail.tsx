"use client";

import { useCallback, useEffect, useState } from "react";

import { EnhanceCard } from "@/components/ai/EnhanceCard";
import { parseChecklist, toggleChecklistItem } from "@/lib/checklist";
import { PRIORITIES, SIZES } from "@/lib/schema";

import type { CardMeta } from "@/lib/schema";

interface FullCard extends CardMeta {
  body: string;
  file: string;
  mtimeMs: number;
}

/**
 * Card detail, docked beside the board rather than floating over it — you keep the
 * column context while editing, which a modal takes away.
 *
 * Loads the body on open instead of shipping every card's prose down with the board.
 */
export function CardDetail({
  slug,
  cardId,
  title,
  onClose,
  onChanged,
}: {
  slug: string;
  cardId: number;
  /** Shown in the header while the body loads. */
  title: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [full, setFull] = useState<FullCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Loading state is reset by remounting — Board keys this component on the card id —
   * rather than by calling setState in the effect body, which would cascade renders.
   *
   * Depending on `cardId` and not on a card object also matters: the board recreates
   * its card array on every optimistic move, so an object dependency would refetch the
   * body on every drag.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(
          `/api/cards?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(String(cardId))}`,
        );
        if (!res.ok) throw new Error(`Could not load card (${res.status})`);
        const data = (await res.json()) as FullCard;
        if (!cancelled) setFull(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, cardId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const request = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/cards", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const detail = (data ?? {}) as { error?: string };
          throw new Error(detail.error ?? `Save failed (${res.status})`);
        }
        return data as { mtimeMs: number };
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  async function toggleCriterion(index: number) {
    if (!full) return;
    const nextBody = toggleChecklistItem(full.body, index);
    if (nextBody === full.body) return;

    const previous = full;
    setFull({ ...full, body: nextBody });

    try {
      const { mtimeMs } = await request({
        kind: "body",
        slug,
        id: full.id,
        body: nextBody,
        expectedMtimeMs: full.mtimeMs,
      });
      setFull((f) => (f ? { ...f, body: nextBody, mtimeMs } : f));
      onChanged();
    } catch (e) {
      setFull(previous);
      setError((e as Error).message);
    }
  }

  async function patchMeta(patch: Record<string, unknown>) {
    if (!full) return;
    const previous = full;
    setFull({ ...full, ...patch } as FullCard);

    try {
      const { mtimeMs } = await request({
        kind: "meta",
        slug,
        id: full.id,
        patch,
        expectedMtimeMs: full.mtimeMs,
      });
      setFull((f) => (f ? ({ ...f, ...patch, mtimeMs } as FullCard) : f));
      onChanged();
    } catch (e) {
      setFull(previous);
      setError((e as Error).message);
    }
  }

  async function trash() {
    if (!full) return;
    if (!window.confirm(`Move "${full.title}" to the trash folder?`)) return;

    try {
      const res = await fetch("/api/cards", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, id: full.id }),
      });
      if (!res.ok) throw new Error(`Could not delete (${res.status})`);
      onClose();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const items = full ? parseChecklist(full.body) : [];

  return (
    <aside className="detail" aria-label="Card detail" data-testid="card-detail">
      <header className="detail-head">
        <span className="mono faint">#{cardId}</span>
        <button type="button" className="link-button mono" onClick={onClose} aria-label="Close">
          close
        </button>
      </header>

      <h2 className="display-sm" style={{ margin: "0 0 12px" }}>
        {full?.title ?? title}
      </h2>

      {error && (
        <div className="notice body-sm" role="alert" data-testid="detail-error">
          {error}
        </div>
      )}

      {!full ? (
        <p className="body-sm faint">Loading...</p>
      ) : (
        <>
          <div className="detail-grid">
            <label className="detail-field">
              <span className="label">Priority</span>
              <select
                className="select"
                value={full.priority}
                disabled={busy}
                aria-label="Priority"
                onChange={(e) => void patchMeta({ priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            <label className="detail-field">
              <span className="label">Size</span>
              <select
                className="select"
                value={full.size}
                disabled={busy}
                aria-label="Size"
                onChange={(e) => void patchMeta({ size: e.target.value })}
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="detail-field">
              <span className="label">Confidence</span>
              <select
                className="select"
                value={full.confidence.toFixed(1)}
                disabled={busy}
                aria-label="Confidence"
                onChange={(e) => void patchMeta({ confidence: Number(e.target.value) })}
              >
                {["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "1.0"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="detail-field">
              <span className="label">Phase</span>
              <select
                className="select"
                value={full.phase === null ? "" : String(full.phase)}
                disabled={busy}
                aria-label="Phase"
                onChange={(e) =>
                  void patchMeta({ phase: e.target.value === "" ? null : Number(e.target.value) })
                }
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="detail-field detail-check">
              <input
                type="checkbox"
                checked={full.blocked}
                disabled={busy}
                aria-label="Blocked"
                onChange={(e) => void patchMeta({ blocked: e.target.checked })}
              />
              <span className="label">Blocked</span>
            </label>
          </div>

          <hr className="rule" />

          <p className="label" style={{ marginTop: 14 }}>
            Acceptance criteria
          </p>

          {items.length === 0 ? (
            <p className="body-sm faint">
              None yet. A criterion that cannot fail is not a criterion.
            </p>
          ) : (
            <ul className="criteria">
              {items.map((item) => (
                <li key={item.index}>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={busy}
                      onChange={() => void toggleCriterion(item.index)}
                    />
                    <span className={item.checked ? "faint" : undefined}>
                      {item.text || <em className="faint">(empty)</em>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <hr className="rule" style={{ marginTop: 18 }} />

          <div style={{ marginTop: 14 }}>
            {/* Refresh the board behind the pane; the pane stays open so the apply
                result remains visible. */}
            <EnhanceCard slug={slug} cardId={full.id} onApplied={onChanged} />
          </div>

          <hr className="rule" style={{ marginTop: 18 }} />

          <button
            type="button"
            className="link-button mono"
            style={{ marginTop: 12, color: "var(--s-blocked)" }}
            onClick={() => void trash()}
          >
            move to trash
          </button>
        </>
      )}
    </aside>
  );
}

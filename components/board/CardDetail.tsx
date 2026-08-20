"use client";

import { useCallback, useEffect, useState } from "react";

import { EnhanceCard } from "@/components/ai/EnhanceCard";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { parseChecklist, toggleChecklistItem } from "@/lib/checklist";
import { confidenceChoices, confidenceLabel, priorityLabel, sizeLabel } from "@/lib/labels";
import { phaseChoices, phaseName } from "@/lib/phases";
import { PRIORITIES, SIZES } from "@/lib/schema";

import type { CardMeta, Phase } from "@/lib/schema";

interface FullCard extends CardMeta {
  body: string;
  file: string;
  mtimeMs: number;
}

/**
 * Card detail, in a drawer.
 *
 * A drawer and not a modal, because the board behind it stays visible AND clickable: a
 * card only makes sense next to its column, and clicking a different card should swap the
 * panel rather than be swallowed by a scrim. It used to be docked in the layout, which
 * kept the context but shrank the board to make room on every screen it opened on.
 *
 * The one thing here that IS modal is moving a card to the trash - a decision, about
 * something the user has to go to the vault to undo. `ConfirmDialog` blocks properly.
 *
 * Loads the body on open instead of shipping every card's prose down with the board.
 */
export function CardDetail({
  slug,
  cardId,
  title,
  phases,
  cards,
  onClose,
  onChanged,
}: {
  slug: string;
  cardId: number;
  /** Shown in the header while the body loads. */
  title: string;
  /** Declared in roadmap.md. With the cards below, these decide what Phase can offer. */
  phases: Phase[];
  cards: readonly { phase: number | null }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [full, setFull] = useState<FullCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [trashing, setTrashing] = useState(false);

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
    setTrashing(true);

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
      // Close the confirmation but not the drawer: the error belongs where the user can
      // read it, and a pane that vanishes takes its own explanation with it.
      setConfirmTrash(false);
      setError((e as Error).message);
    } finally {
      setTrashing(false);
    }
  }

  const items = full ? parseChecklist(full.body) : [];

  return (
    <>
      <Drawer
        // The id is in the title because it is how a card is referred to everywhere else -
        // in a commit message, in a proposal, in the vault's filenames.
        title={`#${cardId} · ${full?.title ?? title}`}
        onClose={onClose}
        testId="card-detail"
      >
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
                {/* Value stays the stored code; only the text is a word. */}
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p)}
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
                    {sizeLabel(s)}
                  </option>
                ))}
              </select>
            </label>

            <label className="detail-field">
              <span className="label">Confidence</span>
              <select
                className="select"
                value={full.confidence.toFixed(2)}
                disabled={busy}
                aria-label="Confidence"
                onChange={(e) => void patchMeta({ confidence: Number(e.target.value) })}
              >
                {/*
                  Built from the card's own value, not a fixed list.
                  A hard-coded 0.1-1.0 had no entry for 0, and none for anything an AI
                  proposal supplies off the tenths - 0.85 matched nothing, so the control
                  rendered BLANK while the file held a real number. Worse, editing any
                  other field then submitted whatever the empty select resolved to,
                  silently rewriting a value nobody touched.
                */}
                {confidenceChoices(full.confidence).map((c) => (
                  <option key={c} value={c.toFixed(2)}>
                    {confidenceLabel(c)}
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
                {/*
                  The phases this project actually has, by the same rule the roadmap uses
                  for its lanes. A fixed 1-8 was wrong twice over: it offered phases that
                  do not exist, and it hid any past 8, so a card in phase 9 showed nothing.
                */}
                {phaseChoices(phases, cards, full.phase).map((n) => (
                  <option key={n} value={n}>
                    {phaseName(phases, n)}
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

          <div style={{ marginTop: 12 }}>
            <Button variant="quiet" danger onClick={() => setConfirmTrash(true)}>
              Move to trash
            </Button>
          </div>
        </>
      )}
      </Drawer>

      {confirmTrash && full && (
        <ConfirmDialog
          title="Move this card to the trash?"
          body={
            <>
              <strong>{full.title}</strong> moves to the project&rsquo;s <code>.trash</code>{" "}
              folder. Nothing is deleted - the file is still there, and the vault&rsquo;s git
              history has it either way - but the app stops showing it and it leaves the
              board.
            </>
          }
          confirmLabel="Move to trash"
          danger
          busy={trashing}
          onConfirm={() => void trash()}
          onCancel={() => setConfirmTrash(false)}
          testId="confirm-trash"
        />
      )}
    </>
  );
}

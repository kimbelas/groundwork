"use client";

import { ArrowDown, ArrowUp, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { EnhanceCard } from "@/components/ai/EnhanceCard";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { Select } from "@/components/ui/Select";
import {
  addChecklistItem,
  moveChecklistItem,
  parseChecklist,
  removeChecklistItem,
  replaceChecklistText,
  toggleChecklistItem,
} from "@/lib/checklist";
import { pushDismissLayer } from "@/lib/dismiss";
import { confidenceChoices, confidenceLabel, priorityLabel, sizeLabel } from "@/lib/labels";
import { phaseChoices, phaseName } from "@/lib/phases";
import { PRIORITIES, SIZES } from "@/lib/schema";
import { createWriteChain, isConflict } from "@/lib/writeChain";

import type { ChecklistItem } from "@/lib/checklist";
import type { CardMeta, Phase } from "@/lib/schema";
import type { WriteChain, WritePayload } from "@/lib/writeChain";

interface FullCard extends CardMeta {
  body: string;
  file: string;
  mtimeMs: number;
}

/** The longest criterion the proposal schema accepts; a longer hand-written one would fail an enhance. */
const CRITERION_MAX = 400;

/**
 * Everything editable about one card: its metadata, its acceptance criteria, its AI
 * enhancements, and the way out (trash). Rendered by the board's drawer and by the card's
 * own page - the same component, so the two can never disagree about how a card is edited.
 *
 * Fetches the card on mount rather than taking it as a prop: the page's server read is for
 * the prose and the heading, and seeding this state from it would be server data in
 * `useState`. There is exactly one writer of the card file per screen, and it is here.
 *
 * ## Writes
 *
 * Every edit - a tick, a new criterion, a rename, a reorder, a priority change - is a
 * write of the same file, and the vault refuses a write whose baseline mtime is stale. One
 * `WriteChain` owns the baseline: writes run in order, each carrying the mtime the one
 * before returned. `viewRef` is the optimistic state (what the user sees, updated
 * synchronously so a second click computes from the first), `confirmedRef` is the last
 * state the server acknowledged (what a failure rolls back to). A real conflict - the file
 * changed on disk under us - locks the chain and offers a reload, never a silent retry.
 */
export function CardEditor({
  slug,
  cardId,
  phases,
  cards,
  onTrashed,
  trashRedirect,
}: {
  slug: string;
  cardId: number;
  /** Declared in roadmap.md. With the cards below, these decide what Phase can offer. */
  phases: Phase[];
  cards: readonly { phase: number | null }[];
  /** The drawer closes itself here; the page navigates instead. */
  onTrashed?: () => void;
  trashRedirect?: string;
}) {
  const router = useRouter();

  const [full, setFull] = useState<FullCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [saving, setSaving] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [trashing, setTrashing] = useState(false);

  const viewRef = useRef<FullCard | null>(null);
  const confirmedRef = useRef<FullCard | null>(null);
  const chainRef = useRef<WriteChain | null>(null);
  const loadSeq = useRef(0);

  const setView = useCallback((next: FullCard | null) => {
    viewRef.current = next;
    setFull(next);
  }, []);

  const send = useCallback(async (payload: WritePayload, expectedMtimeMs: number) => {
    setSaving((n) => n + 1);
    try {
      const res = await fetch("/api/cards", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, expectedMtimeMs }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (data ?? {}) as { error?: string; code?: string };
        throw Object.assign(new Error(detail.error ?? `Save failed (${res.status})`), {
          code: detail.code,
          status: res.status,
        });
      }
      return data as { mtimeMs: number };
    } finally {
      setSaving((n) => n - 1);
    }
  }, []);

  /**
   * Depending on `cardId` and not on a card object matters: the board recreates its card
   * array on every optimistic move, so an object dependency would refetch on every drag.
   */
  const fetchCard = useCallback(async (): Promise<FullCard> => {
    const res = await fetch(
      `/api/cards?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(String(cardId))}`,
    );
    if (!res.ok) throw new Error(`Could not load card (${res.status})`);
    return (await res.json()) as FullCard;
  }, [slug, cardId]);

  /** Make a freshly read card the baseline. Refs only; the caller sets the state. */
  const adopt = useCallback(
    (data: FullCard) => {
      confirmedRef.current = data;
      viewRef.current = data;
      if (chainRef.current) chainRef.current.reset(data.mtimeMs);
      else {
        chainRef.current = createWriteChain({
          initialMtimeMs: data.mtimeMs,
          send,
          onConflict: () => setConflicted(true),
        });
      }
    },
    [send],
  );

  /*
   * The open. Inline, with state set only after the fetch resolves - the shape the compiler
   * lint accepts. Loading state is reset by remounting (callers key this component on the
   * card id), never by setState in the effect body.
   */
  useEffect(() => {
    let cancelled = false;
    loadSeq.current += 1;

    void (async () => {
      try {
        const data = await fetchCard();
        if (cancelled) return;
        adopt(data);
        setConflicted(false);
        setError(null);
        setFull(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchCard, adopt]);

  /**
   * Re-read the card: after an enhance apply (the file's mtime moved under us) and from the
   * conflict notice. Event-driven, never from an effect. The counter drops a stale response.
   */
  const load = useCallback(async () => {
    loadSeq.current += 1;
    const mine = loadSeq.current;
    try {
      const data = await fetchCard();
      if (mine !== loadSeq.current) return;
      adopt(data);
      setConflicted(false);
      setError(null);
      setFull(data);
    } catch (e) {
      if (mine === loadSeq.current) setError((e as Error).message);
    }
  }, [fetchCard, adopt]);

  const reloadCard = useCallback(async () => {
    await chainRef.current?.idle();
    await load();
  }, [load]);

  /**
   * One write. `compute` sees the latest optimistic state and returns the next one plus
   * the payload; the chain adds the baseline. Success confirms and refreshes the server
   * render behind this component (the board, or the page's prose); failure rolls back to
   * the last confirmed state. A follower dropped because an earlier write failed
   * ("skipped") rolls back too but adds no second message - the first one said it all.
   */
  const write = useCallback(
    async (
      compute: (current: FullCard) => { next: FullCard; payload: WritePayload } | null,
    ) => {
      const chain = chainRef.current;
      const current = viewRef.current;
      if (!chain || !current) return;
      const planned = compute(current);
      if (!planned) return;

      setView(planned.next);
      setError(null);

      try {
        const { mtimeMs } = await chain.enqueue(planned.payload);
        confirmedRef.current = { ...planned.next, mtimeMs };
        if (viewRef.current) setView({ ...viewRef.current, mtimeMs });
        router.refresh();
      } catch (e) {
        if (confirmedRef.current) setView(confirmedRef.current);
        if (isConflict(e)) setConflicted(true);
        if ((e as { code?: string }).code !== "skipped") setError((e as Error).message);
      }
    },
    [router, setView],
  );

  const writeBody = useCallback(
    (transform: (body: string) => string) =>
      write((current) => {
        const body = transform(current.body);
        if (body === current.body) return null;
        return {
          next: { ...current, body },
          payload: { kind: "body", slug, id: current.id, body },
        };
      }),
    [slug, write],
  );

  const patchMeta = (patch: Record<string, unknown>) =>
    write((current) => ({
      next: { ...current, ...patch } as FullCard,
      payload: { kind: "meta", slug, id: current.id, patch },
    }));

  const toggleCriterion = (index: number) => writeBody((b) => toggleChecklistItem(b, index));
  const addCriterion = (text: string) => writeBody((b) => addChecklistItem(b, text));
  const renameCriterion = (index: number, text: string) =>
    writeBody((b) => replaceChecklistText(b, index, text));
  const removeCriterion = (index: number) => writeBody((b) => removeChecklistItem(b, index));
  const moveCriterion = (index: number, by: number) =>
    writeBody((b) => moveChecklistItem(b, index, by));

  const cancelEdit = useCallback(() => setEditing(null), []);

  /*
   * Escape in the add field clears what was typed; a second Escape closes whatever layer is
   * beneath (the drawer, when there is one). The layer is pushed only while there is
   * something to clear. Through lib/dismiss.ts, never a key handler on the input - both
   * would fire, and a drawer would close under the user's draft.
   */
  const hasDraft = draft !== "";
  const clearDraft = useCallback(() => setDraft(""), []);
  useEffect(() => {
    if (!hasDraft) return;
    return pushDismissLayer(clearDraft);
  }, [hasDraft, clearDraft]);

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
      onTrashed?.();
      if (trashRedirect) router.replace(trashRedirect);
      router.refresh();
    } catch (e) {
      // Close the confirmation but not the editor: the error belongs where the user can
      // read it, and a surface that vanishes takes its own explanation with it.
      setConfirmTrash(false);
      setError((e as Error).message);
    } finally {
      setTrashing(false);
    }
  }

  const items = full ? parseChecklist(full.body) : [];
  const nameOf = (item: ChecklistItem) => item.text || `criterion ${item.index + 1}`;
  /*
   * While a row is being edited, nothing may reorder the list. The editor is addressed by
   * index, so a move under it would make its Save land on a different criterion - "Second"
   * overwritten with the draft of "Third", silently. Locking the move buttons closes that;
   * keying the editor on the text as well (below) closes the reload and rollback cases.
   */
  const reordering = conflicted || editing !== null;

  return (
    <>
      {error && (
        <Notice data-testid="detail-error">
          {error}
          {conflicted && (
            <>
              {" "}
              <Button variant="quiet" onClick={() => void load()} data-testid="detail-reload">
                Reload card
              </Button>
            </>
          )}
        </Notice>
      )}

      {!full ? (
        <p className="body-sm faint">Loading...</p>
      ) : (
        <>
          <div className="detail-grid">
            <label className="detail-field">
              <span className="label">Priority</span>
              <Select
                label="Priority"
                value={full.priority}
                disabled={conflicted}
                onChange={(e) => void patchMeta({ priority: e.target.value })}
              >
                {/* Value stays the stored code; only the text is a word. */}
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p)}
                  </option>
                ))}
              </Select>
            </label>

            <label className="detail-field">
              <span className="label">Size</span>
              <Select
                label="Size"
                value={full.size}
                disabled={conflicted}
                onChange={(e) => void patchMeta({ size: e.target.value })}
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {sizeLabel(s)}
                  </option>
                ))}
              </Select>
            </label>

            <label className="detail-field">
              <span className="label">Confidence</span>
              <Select
                label="Confidence"
                value={full.confidence.toFixed(2)}
                disabled={conflicted}
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
              </Select>
            </label>

            <label className="detail-field">
              <span className="label">Phase</span>
              <Select
                label="Phase"
                value={full.phase === null ? "" : String(full.phase)}
                disabled={conflicted}
                onChange={(e) =>
                  void patchMeta({
                    phase: e.target.value === "" ? null : Number(e.target.value),
                  })
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
              </Select>
            </label>

            <label className="detail-field detail-check">
              <input
                type="checkbox"
                checked={full.blocked}
                disabled={conflicted}
                aria-label="Blocked"
                onChange={(e) => void patchMeta({ blocked: e.target.checked })}
              />
              <span className="label">Blocked</span>
            </label>
          </div>

          <hr className="rule" />

          {/* The section keeps its testid when empty: "which screen am I on" must not
              depend on whether it has content. */}
          <section className="criteria-section" data-testid="criteria">
            <div
              className="row"
              style={{ justifyContent: "space-between", gap: 12, marginTop: 14 }}
            >
              <p className="label" style={{ margin: 0 }}>
                Acceptance criteria
              </p>
              {saving > 0 && (
                <span className="mono faint" data-testid="detail-saving">
                  Saving…
                </span>
              )}
            </div>

            {items.length === 0 ? (
              <p className="body-sm faint">
                None yet. A criterion that cannot fail is not a criterion.
              </p>
            ) : (
              <ul className="criteria" data-testid="criteria-list">
                {items.map((item) => (
                  <li
                    key={item.index}
                    className="criterion-row"
                    data-testid={`criterion-${item.index}`}
                  >
                    {editing === item.index ? (
                      <CriterionEditor
                        // Index AND text: if the line under the editor changes (a reload, a
                        // rollback), the editor remounts with the new text rather than
                        // saving a stale draft over it.
                        key={`${item.index}:${item.text}`}
                        item={item}
                        disabled={conflicted}
                        onSave={(text) => {
                          setEditing(null);
                          void renameCriterion(item.index, text);
                        }}
                        onRemove={() => {
                          setEditing(null);
                          void removeCriterion(item.index);
                        }}
                        onCancel={cancelEdit}
                      />
                    ) : (
                      <>
                        <label>
                          <input
                            type="checkbox"
                            checked={item.checked}
                            disabled={conflicted}
                            onChange={() => void toggleCriterion(item.index)}
                          />
                          <span className={item.checked ? "faint" : undefined}>
                            {item.text || <em className="faint">(empty)</em>}
                          </span>
                        </label>
                        <div className="criterion-controls">
                          <IconButton
                            label={`Edit ${nameOf(item)}`}
                            disabled={conflicted}
                            onClick={() => setEditing(item.index)}
                            data-testid={`criterion-edit-${item.index}`}
                          >
                            <Pencil size={16} strokeWidth={2} />
                          </IconButton>
                          <IconButton
                            label={`Move ${nameOf(item)} up`}
                            disabled={reordering || item.index === 0}
                            onClick={() => void moveCriterion(item.index, -1)}
                            data-testid={`criterion-up-${item.index}`}
                          >
                            <ArrowUp size={16} strokeWidth={2} />
                          </IconButton>
                          <IconButton
                            label={`Move ${nameOf(item)} down`}
                            disabled={reordering || item.index === items.length - 1}
                            onClick={() => void moveCriterion(item.index, 1)}
                            data-testid={`criterion-down-${item.index}`}
                          >
                            <ArrowDown size={16} strokeWidth={2} />
                          </IconButton>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form
              className="row criterion-add"
              onSubmit={(e) => {
                e.preventDefault();
                const text = draft.trim();
                if (!text) return;
                setDraft("");
                void addCriterion(text);
              }}
            >
              <Input
                label="New criterion"
                placeholder="A criterion that could fail"
                value={draft}
                maxLength={CRITERION_MAX}
                disabled={conflicted}
                onChange={(e) => setDraft(e.target.value)}
                data-testid="criterion-add-input"
              />
              <Button
                type="submit"
                disabled={conflicted || !draft.trim()}
                data-testid="criterion-add"
              >
                Add
              </Button>
            </form>
          </section>

          <hr className="rule" style={{ marginTop: 18 }} />

          <div style={{ marginTop: 14 }}>
            {/* Refresh the server render behind this and re-read the card: the apply moved
                the file's mtime, and an editor holding the old one would conflict on its
                next write. The review stays mounted so the apply result remains visible. */}
            <EnhanceCard
              slug={slug}
              cardId={full.id}
              onApplied={() => {
                router.refresh();
                void reloadCard();
              }}
            />
          </div>

          <hr className="rule" style={{ marginTop: 18 }} />

          <div style={{ marginTop: 12 }}>
            <Button variant="quiet" danger onClick={() => setConfirmTrash(true)}>
              Move to trash
            </Button>
          </div>
        </>
      )}

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

/**
 * One criterion, being edited. Replaces the row; remove lives here so deleting a line is
 * a two-step act without a dialog for something the user can retype.
 *
 * While open it is the top dismiss layer, so Escape cancels the edit and a second Escape
 * closes whatever is beneath - the same shape as a confirmation over a drawer. Not a key
 * handler on the input: a drawer's listener would fire too and close both.
 */
function CriterionEditor({
  item,
  disabled,
  onSave,
  onRemove,
  onCancel,
}: {
  item: ChecklistItem;
  disabled: boolean;
  onSave: (text: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(item.text);

  useEffect(() => pushDismissLayer(onCancel), [onCancel]);

  return (
    <form
      className="row criterion-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const next = text.trim();
        if (!next || next === item.text) {
          onCancel();
          return;
        }
        onSave(next);
      }}
    >
      <Input
        label="Criterion text"
        value={text}
        autoFocus
        maxLength={CRITERION_MAX}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        data-testid="criterion-input"
      />
      <Button type="submit" disabled={disabled} data-testid="criterion-save">
        Save
      </Button>
      <Button variant="quiet" onClick={onCancel}>
        cancel
      </Button>
      <Button
        variant="quiet"
        danger
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Remove ${item.text || `criterion ${item.index + 1}`}`}
        data-testid="criterion-remove"
      >
        remove
      </Button>
    </form>
  );
}

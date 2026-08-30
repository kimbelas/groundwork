"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { applyCap, nextToastId, SUCCESS_MS, type ToastRecord, type ToastTone } from "@/lib/toast";

import { IconButton } from "./IconButton";

/**
 * Transient confirmation, so an action can report itself after the surface that took it is gone.
 *
 * ## Why this exists
 *
 * `CLAUDE.md`: *"A UI component must not unmount itself before reporting what it did… Three
 * separate bugs of this shape have shipped and been caught."* Every fix so far has been "keep
 * the pane open", which works until the pane genuinely has to close: moving a card to the trash
 * closes its drawer, creating a project navigates away, and a re-check on Settings can succeed
 * having changed nothing on screen at all. This is the first mechanism here that lets a
 * confirmation outlive its surface.
 *
 * ## What a toast may carry
 *
 * **A fact, never a record and never an action.** A fact is one sentence nobody reads back
 * later ("Card moved to trash"). A record — which files were written, where, what was replaced —
 * has to stay on screen, so the inline `Notice` keeps it and the toast says the short version.
 * A control inside something that expires is a control that disappears mid-reach, so a
 * "Reload the review" button stays inline too.
 *
 * ## Escape
 *
 * The toast layer does **not** push a `lib/dismiss.ts` layer. Escape's contract in this app is
 * "dismiss the thing you are working in", and a toast is not a thing you are working in — it
 * would steal Escape from the drawer underneath it.
 */

interface ToastApi {
  /** Raise a success. Returns its id, so a caller can dismiss it early. */
  success(text: string): string;
  /** Raise a failure. It stays until dismissed. */
  error(text: string): string;
  dismiss(id: string): void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  /*
   * What the live regions announce, held separately from the visible stack.
   *
   * Keyed by toast id when rendered, so raising the same sentence twice still announces: a
   * screen reader speaks a *mutation* of the region, and re-rendering identical text is not
   * one. Clicking Re-check twice with an unchanged account is exactly that case.
   */
  const [announced, setAnnounced] = useState<{
    polite: ToastRecord | null;
    assertive: ToastRecord | null;
  }>({ polite: null, assertive: null });

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const raise = useCallback((tone: ToastTone, text: string): string => {
    const record: ToastRecord = { id: nextToastId(), tone, text };
    setToasts((list) => applyCap(list, record));
    setAnnounced((prev) =>
      tone === "error" ? { ...prev, assertive: record } : { ...prev, polite: record },
    );
    return record.id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => raise("success", text),
      error: (text) => raise("error", text),
      dismiss,
    }),
    [raise, dismiss],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} announced={announced} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

/**
 * The visible stack and, separately, the announcers.
 *
 * The stack itself carries no live semantics: if it did, every message would be read out with
 * its dismiss button appended ("Card moved to trash, Dismiss button"). Two visually hidden
 * regions hold a copy of the text instead — `polite` for successes, `assertive` for failures.
 *
 * They are `aria-live` with no `role`. An always-mounted `role="alert"` would put a matching
 * element on every page in the app, and `tests-e2e/repo.spec.ts` already carries the scar of an
 * unscoped `getByRole("alert")` colliding with an unrelated live region. `aria-live` announces
 * identically and adds nothing to the accessibility tree for a locator to trip over.
 *
 * Both regions are rendered from the start, empty. A screen reader only announces mutations to
 * a region it was already observing, so one that appears together with its first message is
 * silent for exactly that message.
 *
 * The cost, stated: the text exists twice in the DOM. Tests must find toasts by `data-testid`,
 * never by text.
 */
function ToastViewport({
  toasts,
  announced,
  onDismiss,
}: {
  toasts: ToastRecord[];
  announced: { polite: ToastRecord | null; assertive: ToastRecord | null };
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="toasts" data-testid="toasts">
      <ol className="toast-list">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </ol>

      <div className="visually-hidden" aria-live="polite" data-testid="toast-announcer">
        {announced.polite && <span key={announced.polite.id}>{announced.polite.text}</span>}
      </div>
      <div
        className="visually-hidden"
        aria-live="assertive"
        aria-atomic="true"
        data-testid="toast-announcer"
      >
        {announced.assertive && (
          <span key={announced.assertive.id}>{announced.assertive.text}</span>
        )}
      </div>
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  /*
   * Read once at mount, lazily rather than in an effect — the same reason `Drawer` captures its
   * opener that way. A toast raised while the tab is in the background (the fetch resolved after
   * the user switched away) must not spend its six seconds unseen.
   */
  const [hidden, setHidden] = useState(() =>
    typeof document === "undefined" ? false : document.hidden,
  );
  const remaining = useRef(SUCCESS_MS);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const paused = hovered || focused || hidden;

  /*
   * One timer per toast, cleaned up on every pause and on unmount, with the time already spent
   * carried across. That shape is also what makes React's double-invoked effects harmless: the
   * cleanup clears the first timer and the second run schedules a fresh one.
   *
   * Deliberately not a `setTimeout` inside the raise handler — that timer cannot be cleared on
   * unmount and cannot be paused, and pausing is not optional: nothing may disappear from under
   * a cursor or out of a keyboard user's focus.
   */
  useEffect(() => {
    if (toast.tone === "error" || paused) return;

    const startedAt = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);

    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, toast.tone, toast.id, onDismiss]);

  return (
    <li
      className="toast"
      data-tone={toast.tone}
      data-testid="toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {/* The text sits outside the announced regions above, so it is never read with the
          button appended. */}
      <span className="toast-text">{toast.text}</span>
      {/*
        Never `.focus()` this, or anything else in here. `Drawer` restores focus only if it
        still had it; a toast stealing focus during a trash makes the drawer skip that restore,
        and six seconds later the toast is gone and focus is on a detached node.
      */}
      <IconButton label="Dismiss" onClick={() => onDismiss(toast.id)} data-testid="toast-dismiss">
        <X size={16} strokeWidth={2} />
      </IconButton>
    </li>
  );
}

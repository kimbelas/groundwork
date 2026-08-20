"use client";

import { useEffect, useRef } from "react";

import { pushDismissLayer } from "@/lib/dismiss";

import { Button } from "./Button";

/**
 * A question with two answers, one of which is hard to undo.
 *
 * ## Why this exists instead of `window.confirm`
 *
 * `window.confirm` worked, and was worse in three ways:
 *
 *  - **It cannot say what is about to happen.** One line of unstyled text, no room to name
 *    the file, show the path it moves to, or say that git still has it. A destructive
 *    prompt that cannot explain itself gets clicked through.
 *  - **It blocks the event loop.** Nothing renders and no in-flight save settles while it
 *    is up, so on a slow write the app is frozen behind a question already answered.
 *  - **Some browsers suppress it** in a background tab, and the action then silently does
 *    not happen.
 *
 * It was tested, via `page.once("dialog", d => d.accept())` — a real handler, not a gap.
 * What that testing could not reach is what the prompt actually SAID, which is the part
 * that matters for a destructive action and the part a component can assert.
 *
 * ## Why this one blocks and a Drawer does not
 *
 * A drawer is where you work and the page behind stays live. A confirmation is where you
 * decide, and there is nothing behind it worth clicking — so this uses `showModal()` and
 * gets a real focus trap, an inert background and a `::backdrop`, which is exactly the
 * behaviour a destructive question should have.
 *
 * Escape still routes through the shared layer stack rather than the browser's own dialog
 * handling, so a confirmation opened from inside a drawer closes the confirmation only.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  testId,
}: {
  title: string;
  /** What is about to happen, and whether it can be undone. */
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => pushDismissLayer(onCancel), [onCancel]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // Opened imperatively, because `showModal()` is the only thing that puts a dialog in
    // the top layer and gives it a focus trap. The `open` attribute alone does neither.
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm"
      data-testid={testId}
      /*
       * `cancel` fires on Escape and on the backdrop-dismiss gesture. It is prevented here
       * because the shared dismiss stack already decides what Escape closes; letting the
       * browser also close this would mean two dismissals for one keypress.
       */
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 className="confirm-title">{title}</h2>
      <div className="confirm-body body-sm">{body}</div>

      <div className="confirm-actions">
        <Button variant="primary" danger={danger} disabled={busy} onClick={onConfirm}>
          {busy ? "Working…" : confirmLabel}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </dialog>
  );
}

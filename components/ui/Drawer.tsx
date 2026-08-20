"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { pushDismissLayer } from "@/lib/dismiss";

import { IconButton } from "./IconButton";
import { cx } from "./cx";

/**
 * A panel that slides in from the right and does not block the page behind it.
 *
 * ## Drawer or modal
 *
 * The rule in this app: **a drawer is where you work, a modal is where you decide.**
 *
 * Editing a card, writing a brief, connecting a repo — all of those want the board or the
 * list still visible and still clickable, because the thing you are editing only makes
 * sense next to its neighbours. Clicking a different card while a drawer is open should
 * swap the drawer, not be swallowed by a scrim. That is why this is deliberately NOT
 * `showModal()`: no focus trap, no inert background, no backdrop.
 *
 * A confirmation is the opposite. It has two answers, it is usually about something you
 * cannot undo, and there is nothing behind it worth reading. That gets `ConfirmDialog`,
 * which blocks properly.
 *
 * ## What it still owes the user
 *
 * Not blocking is not the same as not being a dialog. Focus moves into the drawer on open
 * and returns to whatever opened it on close — otherwise a keyboard user is left where the
 * board was and has to tab through the whole page to reach what just appeared. Escape
 * closes it, through the shared layer stack rather than its own `window` listener, so a
 * confirmation opened on top of a drawer does not close both.
 */
export function Drawer({
  title,
  onClose,
  children,
  footer,
  className,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Actions pinned to the bottom, so they stay reachable in a long drawer. */
  footer?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const headingId = useId();

  /*
   * Captured on the FIRST render, not in an effect.
   *
   * Effects run child-first after the whole subtree has committed, and a child marked
   * `autoFocus` has already taken focus by then - so reading `document.activeElement` in the
   * effect recorded a field INSIDE this drawer as the thing to return focus to, and closing
   * restored focus to a detached node, which is the same as losing it. The first render is
   * the last moment the opener is still the opener.
   *
   * A lazy `useState` initializer rather than a ref written during render: it runs at exactly
   * the same moment, and writing a ref there is the thing `react-hooks/refs` correctly
   * refuses - a value captured that way is not guaranteed to survive a re-render that React
   * throws away.
   */
  const [opener] = useState<Element | null>(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );

  useEffect(() => pushDismissLayer(onClose), [onClose]);

  useEffect(() => {
    /*
     * Move focus in, and put it back on the way out.
     *
     * Returning focus is the part that is easy to skip and obvious when missing: close a
     * drawer opened from a card and focus would otherwise reset to the document, so the
     * next Tab starts from the top of the page rather than from the card you were just on.
     */

    // Captured now, not read in the cleanup. By the time cleanup runs React has already
    // cleared the ref, so `panel.current` would be null and the containment check below
    // would never be true - focus would silently never return.
    const node = panel.current;

    // Only if a child has not already claimed it. A form's first field marked `autoFocus`
    // is focused during commit, before this runs, and focusing the panel here would drag
    // focus straight back off it - defeating the autofocus and landing the user on a
    // container instead of the field they are meant to type in.
    if (node && !node.contains(document.activeElement)) node.focus();

    return () => {
      /*
       * Restore focus only if the drawer still had it.
       *
       * The containment check alone is not enough, and testing found out why: this is a
       * passive effect, so by the time cleanup runs React has already detached the node and
       * focus has fallen to `<body>`. `node.contains(document.activeElement)` is then false
       * and focus was never restored - Escape left a keyboard user at the top of the
       * document with no idea where they had been.
       *
       * `body` (or nothing) means the browser dropped focus because what held it went away,
       * which is precisely this case. An element that is neither means the user has clicked
       * somewhere else in the meantime, and pulling focus off it would be the rude thing to
       * do.
       */
      const active = document.activeElement;
      const focusWasHere = !active || active === document.body || node?.contains(active);
      const back = opener as HTMLElement | null;
      if (focusWasHere && back?.isConnected) back.focus?.();
    };
    // `opener` is captured once by a lazy initializer and never reassigned, so it is stable
    // for this component's whole life - but listing it says that rather than assuming it.
  }, [opener]);

  return (
    <div
      ref={panel}
      className={cx("drawer", className)}
      role="dialog"
      /*
       * Explicitly false. It is a real dialog and it genuinely does not trap — saying so
       * is what tells a screen reader the rest of the page is still available, which is
       * the behaviour this component is built around.
       */
      aria-modal="false"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid={testId}
    >
      <div className="drawer-head">
        <h2 id={headingId} className="drawer-title">
          {title}
        </h2>
        <IconButton label="Close" onClick={onClose} data-testid="drawer-close">
          {/* IconButton already wraps this in an aria-hidden glyph span. */}
          <svg viewBox="0 0 20 20">
            <path
              d="M5 5l10 10M15 5L5 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </IconButton>
      </div>

      <div className="drawer-body">{children}</div>

      {footer && <div className="drawer-foot">{footer}</div>}
    </div>
  );
}

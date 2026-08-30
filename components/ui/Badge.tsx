import type { ReactNode } from "react";

import { cx } from "./cx";

/**
 * A small count pill: the number of open questions beside a project name, on a tab, in a
 * table cell. Same treatment everywhere, because the rail once showed "2?" in plain grey
 * text while the tab bar showed a proper badge for the same number.
 *
 * `label` is required and becomes the badge's accessible name and its tooltip, so the
 * digit alone is never what a screen reader announces or what a hovering user is left to
 * guess at. `openQuestionsLabel` in lib/labels.ts produces the usual one.
 */
export interface BadgeProps {
  /** What the number means, in words: "2 open questions". */
  label: string;
  className?: string;
  children: ReactNode;
}

export function Badge({ label, className, children }: BadgeProps) {
  return (
    <span className={cx("badge", "mono", className)} aria-label={label} title={label}>
      {children}
    </span>
  );
}

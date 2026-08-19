import type { ReactNode } from "react";

import { cx } from "./cx";

/**
 * Something the reader needs to know, announced rather than merely displayed.
 *
 * Every error surface in this app hand-wrote `<div className="notice body-sm" role="alert">`,
 * and the ones that forgot `role="alert"` are invisible to a screen reader — the message
 * appears, nothing says it. That is precisely the moment announcement matters, since the
 * user has just tried something that failed.
 *
 * `tone` decides the role, and the mapping is the point: only a problem interrupts.
 * A confirmation uses `status`, which waits for a pause instead of cutting in.
 */
export type NoticeTone = "problem" | "info";

export function Notice({
  tone = "problem",
  children,
  className,
  ...rest
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "role" | "children" | "className">) {
  return (
    <div
      // `.notice` already carries the blocked-hue rule down its left edge, so a problem
      // needs no extra class — only the calmer variant does.
      className={cx("notice", "body-sm", tone === "info" && "notice-info", className)}
      role={tone === "problem" ? "alert" : "status"}
      {...rest}
    >
      {children}
    </div>
  );
}

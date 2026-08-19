import type { ReactNode } from "react";

import { cx } from "./cx";

/**
 * Something the reader needs to know, announced rather than merely displayed.
 *
 * Every error surface in this app hand-wrote `<div className="notice body-sm" role="alert">`,
 * and the ones that forgot `role="alert"` are invisible to a screen reader — the message
 * appears and nothing says it. That is precisely the moment announcement matters, since the
 * user has just tried something that failed.
 *
 * There is no tone prop. One existed for a calmer variant with no caller, and an unused
 * branch is a claim rather than a feature — it can come back the moment something needs it.
 */
export function Notice({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "role" | "children" | "className">) {
  return (
    <div {...rest} className={cx("notice", "body-sm", className)} role="alert">
      {children}
    </div>
  );
}

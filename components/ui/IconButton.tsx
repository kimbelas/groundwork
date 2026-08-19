import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";

/**
 * A button whose whole content is an icon.
 *
 * `label` is required, not optional, and that is the entire reason this component exists
 * separately from `Button`. An icon-only control has no accessible name unless someone
 * remembers to add one, and roughly twenty end-to-end assertions in this app locate
 * controls by their name — so forgetting it breaks the suite in a way that reads as a
 * selector problem rather than an accessibility one.
 *
 * Making it a required prop means the compiler asks, rather than a reviewer.
 */
export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  /** The accessible name. Says what pressing it does, not what the glyph depicts. */
  label: string;
  children: ReactNode;
}

export function IconButton({ label, className, type, children, ...rest }: IconButtonProps) {
  return (
    <button
      // `rest` is spread FIRST, so nothing in it can win over the name below. The
      // `Omit<..., "aria-label">` in the props type looks like it prevents that, but
      // TypeScript does not excess-property-check hyphenated JSX attributes — a caller
      // writing `aria-label="…"` compiles fine, and spread last it would silently replace
      // the required label with an unchecked one. Order is the actual guarantee here.
      {...rest}
      type={type ?? "button"}
      className={cx("icon-button", className)}
      aria-label={label}
      title={label}
    >
      {/* The glyph is decoration; the name above is what a screen reader announces. */}
      <span aria-hidden="true" className="icon-button-glyph">
        {children}
      </span>
    </button>
  );
}

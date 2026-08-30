import type { ReactNode, SelectHTMLAttributes } from "react";

import { cx } from "./cx";

/**
 * A native <select> wearing the design system.
 *
 * Why a component rather than a class: a <select> is a replaced element, so it cannot carry
 * a ::after for the chevron, and a chevron drawn as a data-URI background image can see
 * neither `currentColor` nor the theme tokens - it would be the wrong colour in dark mode and
 * the linter could not see a hex hidden inside it. So the arrow is a sibling SVG, which
 * needs a wrapper, which is this.
 *
 * `label` is required for the same reason it is on `IconButton` and `Input`: the e2e suite
 * finds every select by its accessible name (`getByLabel("Stage").selectOption(...)`), and a
 * missing name would surface as a selector failure rather than an accessibility one.
 *
 * The option list itself is painted by the OS and cannot be styled; `color-scheme` on the
 * theme blocks in globals.css is what keeps it the right colour.
 */
export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "aria-label" | "className"> {
  /** The accessible name. Says what the value is, not what the control looks like. */
  label: string;
  /** Applied to the wrapper, which is the element that takes width. */
  className?: string;
  children: ReactNode;
}

export function Select({ label, className, children, ...rest }: SelectProps) {
  return (
    <span className={cx("select-wrap", className)}>
      {/* `rest` is spread FIRST, so nothing in it can win over the name and class below. */}
      <select {...rest} className="select" aria-label={label}>
        {children}
      </select>
      <svg className="select-chevron" viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M5 8l5 5 5-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

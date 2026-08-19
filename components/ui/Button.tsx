import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx, variant } from "./cx";

/**
 * The one place that decides what a button is.
 *
 * Before this, every button in the app hand-wrote `className="button"` or
 * `className="link-button"` and remembered `type="button"` on its own — and a `<button>`
 * inside a `<form>` without an explicit type submits it, which is a bug you find by
 * accident. Defaulting the type here removes a whole category of that.
 *
 * The variants map to classes that already exist in `globals.css`. Introducing a parallel
 * set would have churned the stylesheet and every e2e assertion for no gain: the value is
 * one definition of a button, not new CSS.
 *
 * No `"use client"`. Nothing here uses a hook, so it stays importable from a server
 * component; a client caller pulls it into the bundle automatically. Primitives that wrap
 * a third-party library will need the directive — this one does not.
 */

const VARIANT = {
  /** Outline. The default, and what most rows want. */
  default: "button",
  /** Solid accent. One per flow, for the action that completes it. */
  primary: "button button-primary",
  /** Text only. Sized by its words, so it takes its hit area from the row around it. */
  quiet: "link-button",
} as const;

export type ButtonVariant = keyof typeof VARIANT;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Renders in the blocked hue. For removal and anything else hard to undo. */
  danger?: boolean;
  children: ReactNode;
}

export function Button({
  variant: name,
  danger = false,
  className,
  type,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // Explicit, always. An unqualified button inside a form submits it.
      type={type ?? "button"}
      className={cx(variant(VARIANT, name, "default"), danger && "is-danger", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

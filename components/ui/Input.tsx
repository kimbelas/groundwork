import type { InputHTMLAttributes } from "react";

import { cx } from "./cx";

/**
 * A text input that cannot ship without an accessible name.
 *
 * Same reasoning as `IconButton`: `label` is required. A bare `<input className="input">`
 * with only a placeholder has no name — placeholders are not labels, they vanish the moment
 * anyone types, and the e2e suite finds fields by `getByLabel`.
 *
 * `invalid` wires `aria-invalid` and the description together, so an error message is
 * announced with the field rather than sitting near it visually and nowhere semantically.
 */
export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "aria-label" | "aria-invalid"> {
  /** The accessible name. Visible or not, it is required. */
  label: string;
  /** Id of an element describing the problem, when there is one. */
  invalid?: string | false;
}

export function Input({ label, invalid, className, ...rest }: InputProps) {
  return (
    <input
      // Spread first, so nothing in `rest` can override the name or the validity wiring
      // below. Omitting `aria-label` from the props type does not actually stop a caller
      // passing it — TypeScript does not excess-property-check hyphenated JSX attributes.
      {...rest}
      className={cx("input", className)}
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={invalid || undefined}
    />
  );
}

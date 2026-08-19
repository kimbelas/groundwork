/**
 * Join class names, dropping anything falsy.
 *
 * Deliberately twelve lines rather than a dependency. The app applies semantic global
 * classes — `.button`, `.card`, `.chip` — so what a primitive needs is "pick one of three
 * variants and allow an override", not the conditional-merge machinery a utility-class
 * codebase needs.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Resolve a variant name to its class, falling back rather than rendering unstyled.
 *
 * The fallback is the point. A typo'd or newly-added variant that lands nowhere renders a
 * bare `<button>` with no styling — which looks like a CSS bug and sends the next reader
 * into the stylesheet. Falling back to the default keeps it a control, and the variant
 * tables are small enough that TypeScript catches the typo first anyway.
 */
export function variant<T extends Record<string, string>>(
  table: T,
  name: keyof T | undefined,
  fallback: keyof T,
): string {
  return (name !== undefined ? table[name] : undefined) ?? table[fallback] ?? "";
}

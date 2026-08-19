/**
 * Slug rules, with no Node imports.
 *
 * Separate from `lib/paths.ts` on purpose: that module imports `node:path`, which cannot
 * be bundled for the browser. The new-project form needs to show the slug a name will
 * produce *before* submitting, so these rules have to be reachable from client code.
 * `lib/paths.ts` re-exports them, so server callers are unaffected.
 */

/** Documented in docs/03-data-model.md. Kept in sync with it deliberately. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Windows treats these as devices no matter the extension, so `vault/nul/project.md` is
 * not a file the OS will let us create or read.
 */
export const RESERVED_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export function isValidSlug(slug: string): boolean {
  if (!SLUG_RE.test(slug)) return false;
  if (RESERVED_DEVICE_NAMES.has(slug)) return false;
  return true;
}

/** Best-effort name → slug. Callers still pass the result through `assertSlug`. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

  if (base.length === 0 || !/^[a-z0-9]/.test(base)) return `project-${base}`.slice(0, 64);
  if (RESERVED_DEVICE_NAMES.has(base)) return `${base}-project`;
  return base;
}

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


/**
 * The last segment of a path, without importing `node:path`.
 *
 * The new-project form previews the name and slug a repository will produce before it
 * submits, and this module is the half of the path rules that can be bundled for the
 * browser - the same reason `slugify` lives here rather than in `lib/paths.ts`.
 *
 * Both separators, because a Windows path arrives with backslashes and a WSL or macOS one
 * with forward slashes, and the field accepts whatever the user's file manager copied.
 * A bare drive letter is not a folder name: `C:\` has no project in it to name.
 */
export function folderNameOf(input: string): string {
  const parts = input.trim().split(/[\\/]+/).filter((part) => part.length > 0);
  const last = parts[parts.length - 1] ?? "";
  return /^[a-zA-Z]:$/.test(last) ? "" : last;
}

/**
 * A folder name as a project name: `tenant-portal_v2` becomes `Tenant Portal V2`.
 *
 * Only the first letter of each word is touched. Upper-casing the rest would turn `myAPI`
 * into `Myapi` and `API` into `Api`, and a repository's own capitalisation is a choice its
 * author already made - this is a starting point for a title, not a correction of one.
 *
 * `.git` is stripped because a bare clone is conventionally `name.git`, and "Myrepo Git"
 * is nobody's project name.
 */
export function nameFromFolder(folder: string): string {
  const words = folder
    .replace(/\.git$/i, "")
    .split(/[-_.\s]+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) return folder;
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

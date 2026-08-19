import path from "node:path";

import { VaultError } from "./errors";
// Imported as well as re-exported: `export ... from` creates no local binding, and
// assertSlug/assertCardFilename below use these directly.
import { isValidSlug, RESERVED_DEVICE_NAMES } from "./slug";

/**
 * Path validation. Pure — no I/O happens here, which is what makes it exhaustively
 * testable and why it is the one place allowed to decide whether a caller-supplied
 * string may become a filesystem path.
 */

export { isValidSlug, RESERVED_DEVICE_NAMES, slugify, SLUG_RE } from "./slug";

/** `0007-billing-api.md` */
export const CARD_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]{0,63}\.md$/;

/** Throws rather than returning a boolean so call sites cannot forget to check. */
export function assertSlug(slug: string): string {
  if (typeof slug !== "string" || !isValidSlug(slug)) {
    throw new VaultError(
      "invalid_slug",
      `Not a usable project slug: ${JSON.stringify(slug)}. ` +
        `Expected lowercase letters, digits and hyphens (max 64), not a Windows device name.`,
    );
  }
  return slug;
}

export function assertCardFilename(name: string): string {
  if (typeof name !== "string" || !CARD_FILE_RE.test(name)) {
    throw new VaultError("invalid_filename", `Not a card filename: ${JSON.stringify(name)}`);
  }
  const stem = name.slice(5, -3);
  if (RESERVED_DEVICE_NAMES.has(stem)) {
    throw new VaultError("invalid_filename", `Card slug is a reserved device name: ${stem}`);
  }
  return name;
}

/**
 * Resolve `segments` under `root` and prove the result is still inside it.
 *
 * The containment check is the real defence — the slug regex already rejects `..`,
 * but this holds even if a future caller reaches here with something unvalidated.
 */
export function containedPath(root: string, ...segments: string[]): string {
  for (const seg of segments) {
    if (typeof seg !== "string" || seg.length === 0) {
      throw new VaultError("escapes_root", "Empty path segment");
    }
    // A NUL byte truncates the path at the syscall layer, so a validated prefix
    // could resolve somewhere else entirely.
    if (seg.includes("\0")) {
      throw new VaultError("escapes_root", "Path segment contains a NUL byte");
    }
    if (path.isAbsolute(seg)) {
      throw new VaultError("escapes_root", `Absolute path segment rejected: ${seg}`);
    }
  }

  const base = path.resolve(root);
  const target = path.resolve(base, ...segments);

  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new VaultError("escapes_root", `Path escapes the vault root: ${target}`);
  }
  return target;
}

/** `7` → `0007`. Card identity is the id; the filename merely carries it. */
export function cardFilename(id: number, titleSlug: string): string {
  return `${String(id).padStart(4, "0")}-${titleSlug}.md`;
}

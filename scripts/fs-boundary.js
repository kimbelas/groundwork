#!/usr/bin/env node
/**
 * Architectural boundary lint: `lib/vault.ts` is the only module that touches disk.
 *
 * Every path validation, the mtime precondition and the atomic-write logic live in that
 * one file. A single `fs` import elsewhere routes around all of it, and that is exactly
 * the kind of shortcut that looks harmless in review. Mechanical enforcement beats a
 * rule in CLAUDE.md that a tired human — or a model — skims past.
 *
 * Takes file paths as arguments; exits non-zero on a violation.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Only these may import fs. Paths are repo-relative, POSIX separators.
 *
 * `lib/runs.ts` is a deliberate, narrow exception rather than a convenience: it stores
 * AI run artefacts under `.groundwork/runs/` and never resolves a path inside `vault/`.
 * Keeping run I/O out of the vault module is what allows the spawned CLI to be granted
 * write access to exactly one directory. It carries its own run-id validation and
 * containment check, mirroring the vault's.
 */
const ALLOWED = new Set([
  "lib/vault.ts",
  "lib/runs.ts",
  // Read-only, owns a third tree, never resolves inside vault/. The full argument for
  // the exception is the header comment of the file itself; the short version is that
  // it is strictly weaker than lib/runs.ts, which is already allowed and writes.
  "lib/repo.ts",
  // Owns .groundwork/index/ and never resolves inside vault/ - the same argument that
  // allows lib/runs.ts. It is the ONLY file under lib/index/ that touches disk; the rest
  // of that directory is pure, which is what lets the chunking and fusion rules be tested
  // without a filesystem.
  "lib/index/store.ts",
  /*
   * The fourth exception, and the only one that writes OUTSIDE this application.
   *
   * The other three own a directory: two inside the app root, and lib/repo.ts a third tree
   * it never writes to at all - which is the whole of that argument, and export cannot
   * borrow it. It writes into a folder the user names, which is neither the vault nor here.
   *
   * So it carries its own contract instead: exactly two filenames, both constants in the
   * module and neither taken from a caller; into an existing directory only, never created;
   * the vault and this app's own root refused in both directions; no delete or rename of
   * anything but its own temp file; and a preview of what it would overwrite before it
   * writes. tests/export.test.ts scans the file and fails if any of that stops being true,
   * the same way tests/repo.test.ts enforces read-only.
   */
  "lib/export.ts",
  "scripts/blueprint-lint.js",
  "scripts/fs-boundary.js",
  "playwright.config.ts",
  "vitest.config.ts",
  "next.config.ts",
]);

/** Test files legitimately set up fixtures on disk. */
const ALLOWED_PREFIXES = ["tests/", "tests-e2e/"];

const FS_IMPORT =
  /^\s*(?:import\s[^;]*?\sfrom\s*|import\s*)["'](?:node:)?fs(?:\/promises)?["']|require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)/gm;

const repoRoot = path.resolve(import.meta.dirname, "..");

const files = process.argv.slice(2).filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
if (files.length === 0) process.exit(0);

let failed = false;

for (const file of files) {
  const rel = path.relative(repoRoot, path.resolve(file)).split(path.sep).join("/");

  if (ALLOWED.has(rel)) continue;
  if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue;
  if (rel.startsWith("node_modules/") || rel.startsWith(".next/")) continue;

  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }

  FS_IMPORT.lastIndex = 0;
  let m;
  while ((m = FS_IMPORT.exec(text)) !== null) {
    const line = text.slice(0, m.index).split(/\r?\n/).length;
    console.error(
      `${rel}:${line}  [fs-boundary]  ${m[0].trim()}\n` +
        `    -> Only lib/vault.ts may touch disk. Add a function there and call it.`,
    );
    failed = true;
  }
}

if (failed) {
  console.error("\nSee docs/02-architecture.md, 'Module boundaries'.");
  process.exit(1);
}

import type { Dirent, Stats } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { VaultError } from "./errors";

/**
 * Read-only access to a connected repository.
 *
 * ## Why this file is allowed to touch `fs`
 *
 * `CLAUDE.md` requires all disk access to go through `lib/vault.ts`, with one exception
 * for `lib/runs.ts`, granted on the argument that it owns a different directory and
 * never resolves a path inside `vault/`. This module is the second exception and rests
 * on the same argument, one step weaker: it owns a third tree, never resolves inside
 * `vault/`, and — unlike `runs.ts` — never writes anything at all.
 *
 * Routing repo reads through `lib/vault.ts` would keep the letter of the rule and lose
 * its reasoning: that module's entire contract is "every path is anchored at the vault
 * root", and a function there that deliberately resolves somewhere else would make the
 * containment guarantee conditional on which function you called. That is worse than a
 * second file whose whole job is a different root.
 *
 * ## What is guaranteed
 *
 * - **No writes.** Nothing here opens a file for writing, creates a directory, or
 *   removes anything. There is no code path to add one without editing this comment.
 * - **Containment.** Every path is resolved under a validated repo root and proved to
 *   still be inside it, lexically and then again against the resolved real path — so a
 *   symlink inside the repo pointing at `~/.ssh` is refused at read time, not followed.
 * - **Never the vault.** A repo that contains the vault, or sits inside it, is rejected
 *   at connect time. Either nesting would let repo-grounded planning quote the vault's
 *   own prose as though it were source code, which is precisely the confusion the
 *   grounding check exists to prevent.
 *
 * ## The contract on callers
 *
 * `validateRepoPath` is the only function that checks a path against the vault, because
 * that check needs a vault root this module deliberately does not import. The readers
 * enforce what they can on their own - the root must be absolute, and nothing may resolve
 * outside it - but they cannot tell whether an absolute root is the vault. **Every reader
 * must be given a path that came from `validateRepoPath`.** A stored `repo:` value is
 * hand-editable frontmatter and has to be re-validated, not trusted.
 *
 * ## What is NOT guaranteed
 *
 * A path validated at connect time can stop being valid at any moment — the directory
 * is renamed, the drive is unplugged, the repo is deleted. Callers must handle failure
 * on every read rather than trusting the stored value, and nothing here may make a
 * project unreadable because its repo went away.
 */

/** Refuse a file larger than this. A source file is prose-sized; anything else is data. */
export const MAX_FILE_BYTES = 512 * 1024;

/** Stop walking after this many entries, so a wrong directory cannot hang a request. */
export const MAX_WALK_ENTRIES = 20_000;

/**
 * Directories never worth reading, skipped during a walk.
 *
 * This is a performance and relevance filter, not a security boundary — containment is
 * what stops a read escaping. Kept deliberately short: a list that tries to name every
 * build directory in existence is a list nobody maintains.
 */
export const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  "target",
  "vendor",
  ".groundwork",
]);

function reject(message: string): never {
  throw new VaultError("invalid_repo", message);
}

/**
 * Check the shape of a repo path without touching the disk.
 *
 * Split from the I/O check so the rules that can be decided from the string alone are
 * exhaustively testable, the same reason `lib/paths.ts` is pure.
 */
export function normalizeRepoPath(input: unknown): string {
  if (typeof input !== "string") reject("A repository path must be a string.");
  const trimmed = input.trim();
  if (trimmed.length === 0) reject("A repository path cannot be empty.");

  // A NUL truncates the path at the syscall layer, so a validated prefix could resolve
  // somewhere else entirely. Same reasoning as `containedPath` in lib/paths.ts.
  if (trimmed.includes("\0")) reject("A repository path cannot contain a NUL byte.");

  if (!path.isAbsolute(trimmed)) {
    reject(
      `A repository must be an absolute path. Got ${JSON.stringify(trimmed)} — ` +
        `a relative path would resolve against whatever directory the server happens ` +
        `to be running in.`,
    );
  }

  // Collapses `.`/`..` and normalises separators, so the stored value is canonical and
  // two spellings of one directory compare equal.
  return path.resolve(trimmed);
}

/**
 * True when `child` is `parent` or sits underneath it.
 *
 * Uses `path.relative` rather than a `startsWith` prefix test because on Windows a path
 * comparison must be case-insensitive: `C:\Repo` and `c:\repo` are one directory, and a
 * literal string compare would report a contained path as an escape — or, in the
 * direction that matters, an escape as contained.
 */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolve `rel` inside `repo` and prove the result is still there.
 *
 * Pure. The real path is checked separately at read time, because a symlink can only be
 * followed by asking the filesystem and this function must stay testable without one.
 */
export function resolveInRepo(repo: string, rel: string): string {
  if (typeof rel !== "string" || rel.trim().length === 0) {
    reject("Empty path inside the repository.");
  }
  if (rel.includes("\0")) reject("Path inside the repository contains a NUL byte.");
  if (path.isAbsolute(rel)) {
    reject(`Absolute path rejected inside a repository: ${rel}`);
  }

  /*
   * Validate the ROOT too, not only the relative part.
   *
   * `path.resolve` on a relative root silently anchors it at the server's cwd, so
   * `resolveInRepo("lib", "vault.ts")` used to hand back a path inside the app's own
   * source. `repo` is a hand-editable frontmatter string: a typo, or someone writing a
   * relative path in Obsidian, is an ordinary event and must fail rather than resolve
   * somewhere plausible.
   *
   * This does not check the repo against the vault - that needs a vault path this module
   * deliberately does not know. `validateRepoPath` does it, and every reader here must be
   * given a path that came from it. See the header comment.
   */
  const root = normalizeRepoPath(repo);
  const target = path.resolve(root, rel);
  if (!isInside(root, target)) {
    throw new VaultError("escapes_root", `Path escapes the repository: ${rel}`);
  }
  return target;
}

export interface RepoInfo {
  /** The canonical absolute path, as stored in frontmatter. */
  path: string;
  /** The directory name, for display when the full path is too long to show. */
  name: string;
}

/**
 * Validate a path a user is trying to connect, against the disk and against the vault.
 *
 * `vaultPath` is passed in rather than read from the environment here: this module must
 * not import `lib/vault.ts` (which would make the dependency circular once the vault
 * layer reads repo metadata), and a function that silently consults `process.env` is
 * one that cannot be tested against a temporary directory.
 */
export async function validateRepoPath(input: unknown, vaultPath: string): Promise<RepoInfo> {
  const resolved = normalizeRepoPath(input);

  let stat: Stats;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    reject(`Nothing exists at ${resolved}.`);
  }
  if (!stat.isDirectory()) {
    reject(`${resolved} is a file, not a directory.`);
  }

  /*
   * Compare real paths, not the strings the user typed.
   *
   * A symlink is the whole reason: `C:\work\repo` pointing at the vault would pass a
   * lexical nesting test and then hand repo-grounded planning the vault's own notes as
   * source material. Resolving both sides first is what makes the check mean something.
   */
  const realRepo = await fsp.realpath(resolved);
  let realVault: string;
  try {
    realVault = await fsp.realpath(vaultPath);
  } catch {
    // No vault on disk yet — nothing to be nested with, so there is nothing to reject.
    realVault = path.resolve(vaultPath);
  }

  if (isInside(realVault, realRepo)) {
    reject(
      `${resolved} is inside the vault. The vault holds plans and the repo holds code; ` +
        `connecting one to the other would let planning quote its own notes as source.`,
    );
  }
  if (isInside(realRepo, realVault)) {
    reject(
      `${resolved} contains the vault. Connecting it would put every plan in scope as ` +
        `though it were source code.`,
    );
  }

  // The canonical form is what gets stored, so a later containment check compares
  // like with like. The symlink the user typed is not preserved: it can be repointed.
  return { path: realRepo, name: path.basename(realRepo) || realRepo };
}

/**
 * Read one file from the repo as text.
 *
 * Re-checks containment against the *real* path after opening, which is the check the
 * lexical one cannot make: `src/link.ts` may be a symlink to somewhere else entirely,
 * and a read that followed it would leave the repo without any path here looking wrong.
 */
export async function readRepoFile(repo: string, rel: string): Promise<string> {
  const target = resolveInRepo(repo, rel);

  let real: string;
  try {
    real = await fsp.realpath(target);
  } catch {
    throw new VaultError("not_found", `No such file in the repository: ${rel}`);
  }
  if (!isInside(path.resolve(repo), real)) {
    throw new VaultError(
      "escapes_root",
      `${rel} is a link out of the repository. Refusing to follow it.`,
    );
  }

  /*
   * Everything past the realpath check is wrapped too. A repo is someone else's working
   * directory - a branch switch, a build, or a `git clean` can delete this file between
   * the two calls, and a raw ENOENT escaping here reaches a route as an unhandled error
   * and a 500 with no message rather than a typed 404.
   */
  let stat: Stats;
  try {
    stat = await fsp.stat(real);
  } catch {
    throw new VaultError("not_found", `No such file in the repository: ${rel}`);
  }

  if (!stat.isFile()) {
    throw new VaultError("not_found", `Not a file in the repository: ${rel}`);
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new VaultError(
      "invalid_document",
      `${rel} is ${Math.round(stat.size / 1024)} KB, over the ${Math.round(
        MAX_FILE_BYTES / 1024,
      )} KB limit for a single file.`,
    );
  }

  try {
    return await fsp.readFile(real, "utf8");
  } catch {
    throw new VaultError("not_found", `Could not read ${rel} from the repository.`);
  }
}

export interface RepoStatus extends RepoInfo {
  /** False when the directory has been moved, renamed, deleted or unplugged. */
  exists: boolean;
}

/**
 * Cheap status for display, safe to call while rendering a page.
 *
 * One `stat`, no walk and no subprocess: the brief page is `force-dynamic`, so anything
 * here is paid on every render. Counting files belongs to the indexing step, where it is
 * an explicit action with visible progress rather than a hidden cost on a page load.
 *
 * Never throws. A project whose repo has gone away must still render — the whole point of
 * showing status is to say so, and a throw in a page takes down the entire screen.
 */
export async function describeRepo(repoPath: string): Promise<RepoStatus> {
  /*
   * A stored value that is not a usable path at all - relative, empty, hand-mangled in
   * Obsidian - reports as absent rather than throwing. The never-throws contract is the
   * whole point: this renders on a page, and the value being broken is exactly when the
   * user needs to see it said out loud.
   */
  let resolved: string;
  try {
    resolved = normalizeRepoPath(repoPath);
  } catch {
    const shown = typeof repoPath === "string" ? repoPath : "";
    return { path: shown, name: shown, exists: false };
  }

  const base = { path: resolved, name: path.basename(resolved) || resolved };
  try {
    const stat = await fsp.stat(resolved);
    return { ...base, exists: stat.isDirectory() };
  } catch {
    return { ...base, exists: false };
  }
}

export interface WalkResult {
  /** Repo-relative paths with forward slashes, sorted, so two walks compare equal. */
  files: string[];
  /** True when the walk stopped at `MAX_WALK_ENTRIES` and `files` is incomplete. */
  truncated: boolean;
}

/**
 * List the files in the repo, breadth-first, skipping `SKIP_DIRS`.
 *
 * Symlinked directories are not descended into. Following them risks both an escape and
 * an infinite loop, and there is no version of "list the files in this project" that
 * needs one.
 *
 * Ordering is deterministic because the result feeds derived artefacts — an index in
 * P2, digest notes in P4 — and a list that reshuffles between runs makes every one of
 * them churn in git for no reason.
 */
export async function listRepoFiles(repo: string): Promise<WalkResult> {
  // Same reason as resolveInRepo: a relative root would anchor at the server's cwd and
  // walk the app's own source. `listRepoFiles("lib")` returned 28 files of it.
  const root = normalizeRepoPath(repo);
  const files: string[] = [];
  let truncated = false;

  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (dir === undefined) break;

    // Typed explicitly: `ReturnType<typeof fsp.readdir>` resolves to the Buffer overload,
    // and the walk needs the string one.
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      // A directory that cannot be read is skipped, not fatal. Permission-denied
      // subtrees are ordinary on a real machine and must not fail the whole walk.
      continue;
    }

    for (const entry of entries) {
      if (files.length >= MAX_WALK_ENTRIES) {
        truncated = true;
        return { files: files.sort(), truncated };
      }

      const full = path.join(dir, entry.name);

      // Neither branch touches a symlink: `withFileTypes` reports the link itself, so
      // `isDirectory()` and `isFile()` are both false for one and it is skipped.
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;

      files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }

  return { files: files.sort(), truncated };
}

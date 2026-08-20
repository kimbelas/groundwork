import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Vault auto-commit.
 *
 * Every accepted apply commits the vault so `git log` becomes the project's decision
 * history and `git revert` a second undo path behind snapshots.
 *
 * The governing rule: **this is bookkeeping and can never fail an apply.** No repo, no
 * git on PATH, a rejecting hook, an empty diff — all return a reason and let the caller
 * carry on. The files are already written; an audit trail that can break the feature it
 * audits is a worse trade than no audit trail.
 *
 * Shells out rather than importing a git library, which is also why this module does
 * not touch `fs` and needs no exception from the filesystem boundary.
 */

export interface CommitResult {
  ok: boolean;
  /** Present when the commit did not happen, explaining why in one line. */
  skipped?: string;
  sha?: string;
}

const GIT_TIMEOUT_MS = 15_000;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * True only when `cwd` is the ROOT of a git repository, not merely inside one.
 *
 * `--is-inside-work-tree` answers a different question: it is true anywhere beneath an
 * enclosing repo. That is not what this module wants. The vault is git-tracked
 * *separately* so its history reads as the project's decision log; if the vault sits
 * inside some other repository — a notes folder in a monorepo, or the e2e fixture vault
 * inside this app's own tree — then a true answer sends every apply's commit into that
 * outer repository instead. The commits land somewhere real, which is what makes the
 * failure quiet: nothing errors, the wrong history just grows.
 *
 * Comparing `--show-toplevel` to `cwd` is the check that matches the intent stated in
 * the caller's own skip message, and in docs/04-ai-layer.md ("silently disabled when
 * vault/.git is absent").
 */
export async function isRepo(cwd: string): Promise<boolean> {
  try {
    const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
    if (!top) return false;
    return path.resolve(top) === path.resolve(cwd);
  } catch {
    return false;
  }
}

/**
 * Stage and commit exactly `relPaths`, and nothing else.
 *
 * Scoping to explicit paths is the whole design. `git commit -a` would sweep unrelated
 * hand-edits from other projects into the commit, which turns an audit trail into
 * noise — precisely the signal this is meant to provide.
 */
/**
 * The commit HEAD points at, or null when there is not one to read.
 *
 * Used as a fast path when deciding whether an index is stale, and never as the only
 * check. A matching SHA proves nothing about the working tree: uncommitted edits are
 * exactly the state a developer is in when they ask a question about their own code, and
 * an index that trusted the SHA would answer about the committed version while looking
 * perfectly fresh. Per-file content hashing is what actually decides.
 *
 * Null covers every "no answer" case — not a repo, no commits yet, git not installed —
 * because the caller treats them all the same: fall through to hashing.
 *
 * Deliberately NOT `isRepo`-gated. This is asked of a connected repository, which is
 * ordinarily the root of its own repo but may legitimately be a subdirectory of one; the
 * toplevel comparison that protects the vault's separate history is the wrong test here.
 */
export async function headSha(cwd: string): Promise<string | null> {
  try {
    const sha = await git(cwd, ["rev-parse", "HEAD"]);
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

export async function commitPaths(
  cwd: string,
  relPaths: string[],
  message: string,
): Promise<CommitResult> {
  if (relPaths.length === 0) return { ok: false, skipped: "nothing to commit" };

  try {
    if (!(await isRepo(cwd))) {
      return { ok: false, skipped: "the vault is not a git repository" };
    }

    // `--` separates paths from revisions, so a filename can never be read as a ref.
    await git(cwd, ["add", "--", ...relPaths]);

    const staged = await git(cwd, ["diff", "--cached", "--name-only", "--", ...relPaths]);
    if (staged.length === 0) {
      return { ok: false, skipped: "no changes to commit" };
    }

    await git(cwd, [
      "-c",
      "user.name=Groundwork",
      "-c",
      "user.email=groundwork@localhost",
      "commit",
      "-m",
      message,
      "--",
      ...relPaths,
    ]);

    const sha = await git(cwd, ["rev-parse", "--short", "HEAD"]);
    return { ok: true, sha };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const reason = (err.stderr || err.message || "git failed").split("\n")[0] ?? "git failed";
    return { ok: false, skipped: reason };
  }
}

export interface CommitSummary {
  job: string;
  runId: string;
  summary: string;
  accepted: string[];
  rejected: number;
  dirtyPaths: string[];
}

/**
 * The commit subject is the proposal's own summary, so `git log --oneline` reads as the
 * project's decision history rather than a wall of "AI update".
 */
export function buildCommitMessage(s: CommitSummary): string {
  const subject = `ai(${s.job}): ${s.summary.split("\n")[0]?.trim() ?? "applied a proposal"}`;
  const lines = [subject.slice(0, 120), "", `Run: ${s.runId}`];

  if (s.accepted.length > 0) lines.push(`Accepted: ${s.accepted.join(", ")}`);
  if (s.rejected > 0) lines.push(`Rejected: ${s.rejected} block${s.rejected === 1 ? "" : "s"}`);

  if (s.dirtyPaths.length > 0) {
    lines.push(
      "",
      "Note: these files already had uncommitted edits, which this commit includes:",
      ...s.dirtyPaths.map((p) => `  ${p}`),
    );
  }

  return lines.join("\n");
}

export function buildRevertMessage(runId: string, snapshotId: string): string {
  return [`revert(ai): undo ${runId}`, "", `Snapshot: ${snapshotId}`].join("\n");
}

/**
 * Which of `relPaths` already have uncommitted changes.
 *
 * An apply commits the file as it stands, so a hand-edit sitting in the working tree
 * rides along. That is the honest outcome — but the commit message should say so rather
 * than implying the whole diff was the model's.
 */
export async function dirtyPaths(cwd: string, relPaths: string[]): Promise<string[]> {
  if (relPaths.length === 0) return [];
  try {
    const out = await git(cwd, ["status", "--porcelain", "--", ...relPaths]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        // Porcelain v1: a two-character status field, then whitespace, then the path.
        // Counting a fixed number of characters is brittle — the separator width
        // varies with the status pair — so strip the field and trim what follows.
        const rest = line.slice(2).trim();
        // Renames are reported as "old -> new"; the new path is the one that matters.
        const arrow = rest.indexOf(" -> ");
        return arrow === -1 ? rest : rest.slice(arrow + 4);
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

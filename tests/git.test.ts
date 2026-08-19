import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildCommitMessage,
  buildRevertMessage,
  commitPaths,
  dirtyPaths,
  isRepo,
} from "@/lib/git";

/**
 * Auto-commit, against a real repository.
 *
 * The e2e fixture vault deliberately has no repo — which exercises the graceful
 * degradation path but never the happy one — so the committing behaviour is covered
 * here, where a throwaway repo is cheap.
 */

const run = promisify(execFile);
let dir: string;

async function git(args: string[], cwd = dir): Promise<string> {
  const { stdout } = await run("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-git-"));
  await git(["init", "-q"]);
  await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "commit.gpgsign", "false"]);

  await fsp.mkdir(path.join(dir, "proj"), { recursive: true });
  await fsp.writeFile(path.join(dir, "proj", "a.md"), "one\n", "utf8");
  await fsp.writeFile(path.join(dir, "proj", "b.md"), "two\n", "utf8");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "baseline"]);
});

/**
 * Windows holds a handle on files git has just touched, so an immediate recursive delete
 * fails with EBUSY. Retry briefly, then give up: this is a directory under the OS temp
 * folder, and failing to remove it must never fail a test about commit behaviour.
 */
async function removeTemp(target: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fsp.rm(target, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
    }
  }
}

afterEach(async () => {
  await removeTemp(dir);
});

describe("isRepo", () => {
  it("recognises a repository", async () => {
    expect(await isRepo(dir)).toBe(true);
  });

  it("returns false rather than throwing outside one", async () => {
    const plain = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-plain-"));
    try {
      expect(await isRepo(plain)).toBe(false);
    } finally {
      await removeTemp(plain);
    }
  });
});

describe("commitPaths", () => {
  it("commits the named paths", async () => {
    await fsp.writeFile(path.join(dir, "proj", "a.md"), "changed\n", "utf8");

    const result = await commitPaths(dir, ["proj/a.md"], "ai(synthesize): a change");
    expect(result.ok).toBe(true);
    expect(result.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(await git(["log", "-1", "--pretty=%s"])).toBe("ai(synthesize): a change");
  });

  it("commits ONLY the named paths, leaving other edits in the working tree", async () => {
    await fsp.writeFile(path.join(dir, "proj", "a.md"), "changed\n", "utf8");
    await fsp.writeFile(path.join(dir, "proj", "b.md"), "also changed\n", "utf8");

    await commitPaths(dir, ["proj/a.md"], "only a");

    // b.md must still be dirty — sweeping it in is what turns an audit trail into noise.
    expect(await git(["status", "--porcelain"])).toContain("proj/b.md");
    expect(await git(["show", "--name-only", "--pretty=", "HEAD"])).toBe("proj/a.md");
  });

  it("commits a newly created file", async () => {
    await fsp.writeFile(path.join(dir, "proj", "c.md"), "new\n", "utf8");
    const result = await commitPaths(dir, ["proj/c.md"], "add c");
    expect(result.ok).toBe(true);
    expect(await git(["show", "--name-only", "--pretty=", "HEAD"])).toBe("proj/c.md");
  });

  it("skips, never throws, when there is nothing to commit", async () => {
    const result = await commitPaths(dir, ["proj/a.md"], "no change");
    expect(result.ok).toBe(false);
    expect(result.skipped).toMatch(/no changes/);
  });

  it("skips, never throws, outside a repository", async () => {
    const plain = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-plain-"));
    try {
      await fsp.writeFile(path.join(plain, "x.md"), "hi\n", "utf8");
      const result = await commitPaths(plain, ["x.md"], "nope");
      expect(result.ok).toBe(false);
      expect(result.skipped).toMatch(/not a git repository/);
    } finally {
      await removeTemp(plain);
    }
  });

  it("skips on an empty path list", async () => {
    const result = await commitPaths(dir, [], "nothing");
    expect(result.ok).toBe(false);
  });

  it("does not treat a path as a revision", async () => {
    // A file literally named like a ref must not be resolved as one.
    await fsp.writeFile(path.join(dir, "proj", "HEAD.md"), "tricky\n", "utf8");
    const result = await commitPaths(dir, ["proj/HEAD.md"], "add HEAD.md");
    expect(result.ok).toBe(true);
  });
});

describe("dirtyPaths", () => {
  it("reports files with uncommitted changes", async () => {
    await fsp.writeFile(path.join(dir, "proj", "a.md"), "changed\n", "utf8");
    expect(await dirtyPaths(dir, ["proj/a.md", "proj/b.md"])).toEqual(["proj/a.md"]);
  });

  it("is empty on a clean tree", async () => {
    expect(await dirtyPaths(dir, ["proj/a.md"])).toEqual([]);
  });

  it("returns empty rather than throwing outside a repository", async () => {
    const plain = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-plain-"));
    try {
      expect(await dirtyPaths(plain, ["x.md"])).toEqual([]);
    } finally {
      await removeTemp(plain);
    }
  });
});

describe("commit messages", () => {
  it("uses the proposal summary as the subject", () => {
    const msg = buildCommitMessage({
      job: "synthesize",
      runId: "run_20260819_0614",
      summary: "Lock the billing contract before touching the portal.",
      accepted: ["4 cards created", "2 questions"],
      rejected: 1,
      dirtyPaths: [],
    });

    expect(msg.split("\n")[0]).toBe(
      "ai(synthesize): Lock the billing contract before touching the portal.",
    );
    expect(msg).toContain("Run: run_20260819_0614");
    expect(msg).toContain("Accepted: 4 cards created, 2 questions");
    expect(msg).toContain("Rejected: 1 block");
  });

  it("takes only the first line of a multi-line summary", () => {
    const msg = buildCommitMessage({
      job: "critique",
      runId: "r",
      summary: "First line.\nSecond line.",
      accepted: [],
      rejected: 0,
      dirtyPaths: [],
    });
    expect(msg.split("\n")[0]).toBe("ai(critique): First line.");
  });

  it("caps the subject length", () => {
    const msg = buildCommitMessage({
      job: "synthesize",
      runId: "r",
      summary: "x".repeat(400),
      accepted: [],
      rejected: 0,
      dirtyPaths: [],
    });
    expect((msg.split("\n")[0] ?? "").length).toBeLessThanOrEqual(120);
  });

  it("declares when pre-existing edits ride along", () => {
    const msg = buildCommitMessage({
      job: "synthesize",
      runId: "r",
      summary: "s",
      accepted: [],
      rejected: 0,
      dirtyPaths: ["proj/project.md"],
    });
    expect(msg).toContain("already had uncommitted edits");
    expect(msg).toContain("proj/project.md");
  });

  it("names the run a revert undoes", () => {
    const msg = buildRevertMessage("run_20260819_0614", "2026-08-19T06-14-00-000Z");
    expect(msg.split("\n")[0]).toBe("revert(ai): undo run_20260819_0614");
    expect(msg).toContain("Snapshot: 2026-08-19T06-14-00-000Z");
  });
});

/**
 * A vault nested inside some *other* repository is not a vault with its own history.
 *
 * `isRepo` used `--is-inside-work-tree`, which is true anywhere beneath an enclosing
 * repo, so every apply's commit went into that outer repository instead — quietly,
 * because the commit really was created. Found when this app's own source was first put
 * under git: the e2e fixture vault lives inside the app tree, and a single suite run
 * wrote four commits into it.
 *
 * The pre-existing "outside one" case cannot catch this: it uses a temp dir that is not
 * inside any repository, so it passed before the fix as well as after.
 */
describe("isRepo — nested inside another repository", () => {
  it("is false for a directory merely inside a repository", async () => {
    const nested = path.join(dir, "vault");
    await fsp.mkdir(nested, { recursive: true });

    expect(await isRepo(nested)).toBe(false);
    expect(await isRepo(dir)).toBe(true);
  });

  it("does not commit into an enclosing repository", async () => {
    const nested = path.join(dir, "vault");
    await fsp.mkdir(nested, { recursive: true });
    await fsp.writeFile(path.join(nested, "note.md"), "planned\n", "utf8");

    const before = await git(["rev-parse", "HEAD"]);
    const result = await commitPaths(nested, ["note.md"], "should not land");

    expect(result.ok).toBe(false);
    expect(result.skipped).toMatch(/not a git repository/);
    expect(await git(["rev-parse", "HEAD"])).toBe(before);
  });
});

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isVaultError } from "@/lib/errors";
import {
  isInside,
  listRepoFiles,
  MAX_FILE_BYTES,
  normalizeRepoPath,
  readRepoFile,
  resolveInRepo,
  SKIP_DIRS,
  validateRepoPath,
} from "@/lib/repo";

/**
 * `lib/repo.ts` is the second exception to the rule that all disk access goes through
 * `lib/vault.ts`. The exception was granted on three claims — read-only, contained, never
 * the vault — so these tests exist to make the claims falsifiable rather than stated.
 *
 * Everything runs against a throwaway directory. Nothing here may touch a real repo.
 */

let root: string;
let repo: string;
let vault: string;

/** Symlinks need elevation or Developer Mode on Windows; the test skips rather than lies. */
let symlinks = true;

async function file(rel: string, contents = "x"): Promise<string> {
  const full = path.join(repo, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, contents, "utf8");
  return full;
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-repo-"));
  repo = path.join(root, "repo");
  vault = path.join(root, "vault");
  await fsp.mkdir(repo, { recursive: true });
  await fsp.mkdir(vault, { recursive: true });

  try {
    const probe = path.join(root, "probe-link");
    await fsp.symlink(vault, probe, "dir");
    await fsp.rm(probe, { force: true });
    symlinks = true;
  } catch {
    symlinks = false;
  }
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

const NL = String.fromCharCode(10);

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return isVaultError(e) ? e.code : `not-a-vault-error:${String(e)}`;
  }
  return "did-not-throw";
}

async function asyncCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return isVaultError(e) ? e.code : `not-a-vault-error:${String(e)}`;
  }
  return "did-not-throw";
}

describe("normalizeRepoPath", () => {
  it("resolves an absolute path to its canonical form", () => {
    const messy = path.join(repo, "src", "..", ".", "src");
    expect(normalizeRepoPath(messy)).toBe(path.join(repo, "src"));
  });

  it("refuses a relative path", () => {
    // A relative path would resolve against the server's cwd, which is not a location
    // the user chose and changes with how the app was started.
    expect(code(() => normalizeRepoPath("../some-repo"))).toBe("invalid_repo");
    expect(code(() => normalizeRepoPath("some-repo"))).toBe("invalid_repo");
  });

  it("refuses empty, whitespace and non-string input", () => {
    expect(code(() => normalizeRepoPath(""))).toBe("invalid_repo");
    expect(code(() => normalizeRepoPath("   "))).toBe("invalid_repo");
    expect(code(() => normalizeRepoPath(null))).toBe("invalid_repo");
    expect(code(() => normalizeRepoPath(42))).toBe("invalid_repo");
  });

  it("refuses a NUL byte", () => {
    // The syscall layer truncates at the NUL, so a validated prefix could resolve
    // somewhere the check never saw.
    expect(code(() => normalizeRepoPath(`${repo}\0/etc/passwd`))).toBe("invalid_repo");
  });

  it("trims surrounding whitespace, which a pasted path carries", () => {
    expect(normalizeRepoPath(`  ${repo}  `)).toBe(path.resolve(repo));
  });
});

describe("isInside", () => {
  it("counts a directory as inside itself", () => {
    expect(isInside(repo, repo)).toBe(true);
  });

  it("recognises a descendant", () => {
    expect(isInside(repo, path.join(repo, "a", "b", "c.ts"))).toBe(true);
  });

  it("rejects a sibling whose name starts with the parent's", () => {
    // The bug a `startsWith` prefix test has: "/repo-backup" begins with "/repo".
    expect(isInside(path.join(root, "repo"), path.join(root, "repo-backup"))).toBe(false);
  });

  it("rejects a parent and an unrelated tree", () => {
    expect(isInside(repo, root)).toBe(false);
    expect(isInside(repo, vault)).toBe(false);
  });

  it("compares case-insensitively where the platform does", () => {
    // Windows: C:\Repo and c:\repo are one directory. Getting this wrong in the
    // permissive direction would report an escape as contained.
    const swapped = repo.toUpperCase();
    const expected = process.platform === "win32";
    expect(isInside(repo, path.join(swapped, "a.ts"))).toBe(expected);
  });
});

describe("resolveInRepo", () => {
  it("resolves a relative path inside the repo", () => {
    expect(resolveInRepo(repo, "src/a.ts")).toBe(path.join(repo, "src", "a.ts"));
  });

  it("rejects traversal out of the repo", () => {
    expect(code(() => resolveInRepo(repo, "../vault/secrets.md"))).toBe("escapes_root");
    expect(code(() => resolveInRepo(repo, "src/../../vault/secrets.md"))).toBe("escapes_root");
  });

  it("rejects an absolute path, which would ignore the root entirely", () => {
    expect(code(() => resolveInRepo(repo, path.join(vault, "secrets.md")))).toBe("invalid_repo");
  });

  it("rejects a NUL byte and an empty segment", () => {
    expect(code(() => resolveInRepo(repo, "src\0/a.ts"))).toBe("invalid_repo");
    expect(code(() => resolveInRepo(repo, ""))).toBe("invalid_repo");
    expect(code(() => resolveInRepo(repo, "   "))).toBe("invalid_repo");
  });

  it("allows a path that traverses up and back down without leaving", () => {
    // Refusing this would be over-strict: it never leaves the root.
    expect(resolveInRepo(repo, "src/../lib/a.ts")).toBe(path.join(repo, "lib", "a.ts"));
  });
});

describe("validateRepoPath", () => {
  it("accepts a real directory outside the vault", async () => {
    const info = await validateRepoPath(repo, vault);
    expect(info.path).toBe(await fsp.realpath(repo));
    expect(info.name).toBe("repo");
  });

  it("refuses a path that does not exist", async () => {
    expect(await asyncCode(() => validateRepoPath(path.join(root, "gone"), vault))).toBe(
      "invalid_repo",
    );
  });

  it("refuses a file", async () => {
    const f = await file("README.md");
    expect(await asyncCode(() => validateRepoPath(f, vault))).toBe("invalid_repo");
  });

  it("refuses a directory inside the vault", async () => {
    // Otherwise repo-grounded planning could quote the vault's own notes as source code,
    // which is exactly the confusion the grounding check exists to prevent.
    const inside = path.join(vault, "some-project");
    await fsp.mkdir(inside, { recursive: true });
    expect(await asyncCode(() => validateRepoPath(inside, vault))).toBe("invalid_repo");
  });

  it("refuses a directory that contains the vault", async () => {
    expect(await asyncCode(() => validateRepoPath(root, vault))).toBe("invalid_repo");
  });

  it("refuses the vault itself", async () => {
    expect(await asyncCode(() => validateRepoPath(vault, vault))).toBe("invalid_repo");
  });

  it("accepts a repo when the vault does not exist on disk yet", async () => {
    // A missing vault has nothing to be nested with. Rejecting here would make the
    // first-run case fail for a reason the user cannot act on.
    const info = await validateRepoPath(repo, path.join(root, "no-vault-here"));
    expect(info.path).toBe(await fsp.realpath(repo));
  });

  it("resolves through a symlink and stores the real path", async () => {
    if (!symlinks) return;
    const link = path.join(root, "link-to-repo");
    await fsp.symlink(repo, link, "dir");

    const info = await validateRepoPath(link, vault);
    expect(info.path).toBe(await fsp.realpath(repo));
    expect(info.path).not.toBe(path.resolve(link));
  });

  it("refuses a symlink that points into the vault", async () => {
    if (!symlinks) return;
    // The case a lexical nesting check cannot see: the path looks unrelated to the
    // vault and resolves straight into it.
    const link = path.join(root, "looks-like-a-repo");
    await fsp.symlink(vault, link, "dir");

    expect(await asyncCode(() => validateRepoPath(link, vault))).toBe("invalid_repo");
  });
});

describe("readRepoFile", () => {
  it("reads a file inside the repo", async () => {
    await file("src/a.ts", "export const a = 1;\n");
    expect(await readRepoFile(repo, "src/a.ts")).toBe("export const a = 1;\n");
  });

  it("reports a missing file as not_found rather than throwing raw ENOENT", async () => {
    expect(await asyncCode(() => readRepoFile(repo, "src/nope.ts"))).toBe("not_found");
  });

  it("refuses a directory", async () => {
    await fsp.mkdir(path.join(repo, "src"), { recursive: true });
    expect(await asyncCode(() => readRepoFile(repo, "src"))).toBe("not_found");
  });

  it("refuses traversal", async () => {
    await fsp.writeFile(path.join(vault, "secret.md"), "private", "utf8");
    expect(await asyncCode(() => readRepoFile(repo, "../vault/secret.md"))).toBe("escapes_root");
  });

  it("refuses to follow a symlink out of the repo", async () => {
    if (!symlinks) return;
    /*
     * The check the lexical one cannot make. `src/leak.md` is a perfectly ordinary
     * repo-relative path; only the filesystem knows it points at the vault. Without the
     * realpath re-check this read succeeds and nothing in the request looks wrong.
     */
    const secret = path.join(vault, "secret.md");
    await fsp.writeFile(secret, "private", "utf8");
    await fsp.mkdir(path.join(repo, "src"), { recursive: true });
    await fsp.symlink(secret, path.join(repo, "src", "leak.md"), "file");

    expect(await asyncCode(() => readRepoFile(repo, "src/leak.md"))).toBe("escapes_root");
  });

  it("refuses a file over the size cap", async () => {
    await file("big.bin", "z".repeat(MAX_FILE_BYTES + 1));
    expect(await asyncCode(() => readRepoFile(repo, "big.bin"))).toBe("invalid_document");
  });

  it("reads a file exactly at the cap", async () => {
    // The boundary is inclusive; an off-by-one here would reject a legitimate file.
    await file("edge.txt", "z".repeat(MAX_FILE_BYTES));
    expect((await readRepoFile(repo, "edge.txt")).length).toBe(MAX_FILE_BYTES);
  });
});

describe("listRepoFiles", () => {
  it("lists files with forward slashes, relative to the repo", async () => {
    await file("src/a.ts");
    await file("src/nested/b.ts");
    await file("README.md");

    const { files, truncated } = await listRepoFiles(repo);
    expect(files).toEqual(["README.md", "src/a.ts", "src/nested/b.ts"]);
    expect(truncated).toBe(false);
  });

  it("skips the directories nobody wants indexed", async () => {
    await file("src/a.ts");
    for (const dir of SKIP_DIRS) await file(`${dir}/junk.ts`);

    const { files } = await listRepoFiles(repo);
    expect(files).toEqual(["src/a.ts"]);
  });

  it("skips a nested build directory, not only a top-level one", async () => {
    await file("packages/web/node_modules/dep/index.js");
    await file("packages/web/src/a.ts");

    const { files } = await listRepoFiles(repo);
    expect(files).toEqual(["packages/web/src/a.ts"]);
  });

  it("returns a stable order, so derived artefacts do not churn", async () => {
    // The result feeds an index and committed digest notes. A list that reshuffles
    // between walks makes every one of them show a diff for no reason.
    await file("z.ts");
    await file("a.ts");
    await file("m/n.ts");

    const first = await listRepoFiles(repo);
    const second = await listRepoFiles(repo);
    expect(first.files).toEqual(second.files);
    expect(first.files).toEqual([...first.files].sort());
  });

  it("does not descend into a symlinked directory", async () => {
    if (!symlinks) return;
    // Following one risks both an escape and an unbounded loop, and no version of
    // "list this project's files" needs it.
    await fsp.writeFile(path.join(vault, "secret.md"), "private", "utf8");
    await fsp.symlink(vault, path.join(repo, "linked"), "dir");
    await file("src/a.ts");

    const { files } = await listRepoFiles(repo);
    expect(files).toEqual(["src/a.ts"]);
  });

  it("returns an empty list for an empty repo rather than throwing", async () => {
    expect(await listRepoFiles(repo)).toEqual({ files: [], truncated: false });
  });

  it("survives a directory it cannot read", async () => {
    // Permission-denied subtrees are ordinary on a real machine. One must not fail the
    // whole walk. Simulated by pointing the walk at a path that vanishes mid-flight.
    await file("src/a.ts");
    const { files } = await listRepoFiles(path.join(repo, "src"));
    expect(files).toEqual(["a.ts"]);
  });

  it("reports a nonexistent root as empty, not as a crash", async () => {
    // A repo can be unplugged between connect and use. A page that renders this must
    // not take the whole screen down.
    expect(await listRepoFiles(path.join(root, "gone"))).toEqual({
      files: [],
      truncated: false,
    });
  });
});

describe("the read-only guarantee", () => {
  it("makes no writing filesystem call anywhere in the module", async () => {
    /*
     * A structural test, deliberately.
     *
     * The exception in CLAUDE.md that lets this file import `fs` at all was granted
     * partly on "it never writes", and a comment saying so is not enforcement - the next
     * person to add a cache here would be adding a write to a module the boundary gate
     * has already waved through.
     *
     * Matched as a member call rather than a bare substring. The first version of this
     * test looked for the word "truncate" and failed on the local variable `truncated`,
     * which is the kind of false positive that gets a guard deleted rather than fixed.
     */
    const source = await fsp.readFile(path.join(process.cwd(), "lib", "repo.ts"), "utf8");
    const code = source
      .split(NL)
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join(NL);

    const WRITES = [
      "writeFile",
      "appendFile",
      "mkdir",
      "mkdtemp",
      "rm",
      "rmdir",
      "unlink",
      "rename",
      "cp",
      "copyFile",
      "createWriteStream",
      "chmod",
      "chown",
      "utimes",
      "symlink",
      "link",
      "truncate",
      "open",
      "openSync",
      "writeSync",
    ];

    for (const call of WRITES) {
      const pattern = new RegExp(String.raw`\.\s*` + call + String.raw`\s*\(`);
      expect(pattern.test(code), `lib/repo.ts must not call .${call}()`).toBe(false);
    }
  });

  it("would catch a write if one were added", () => {
    // Proves the matcher above is not vacuous: the same pattern fires on a line that
    // does write. Without this, a broken regex reads as a clean module.
    const sample = `await fsp.writeFile(target, "x", "utf8");`;
    expect(/\.\s*writeFile\s*\(/.test(sample)).toBe(true);
  });

  it("does not fire on an identifier that merely contains a call name", () => {
    // `truncated` contains "truncate"; `linked` contains "link". Both are legitimate.
    const sample = `let truncated = false; const linked = queue.shift();`;
    expect(/\.\s*truncate\s*\(/.test(sample)).toBe(false);
    expect(/\.\s*link\s*\(/.test(sample)).toBe(false);
  });
});

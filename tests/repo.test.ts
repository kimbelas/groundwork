import fsSync from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isVaultError } from "@/lib/errors";
import {
  describeRepo,
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

/**
 * Can this machine make a directory link at all?
 *
 * Probed once at module load, not per test, because `it.skipIf` is evaluated when the file
 * is collected. The previous version set a flag in `beforeEach` and each symlink test
 * began `if (!symlinks) return;` - so on Windows, where `symlink(..., "dir")` returns
 * EPERM without elevation, four tests reported GREEN while asserting nothing. A review
 * proved it by disabling both symlink guards in `lib/repo.ts`: the file still passed 42/42.
 *
 * A **junction** needs no elevation and exercises the identical code path - `readdir`
 * reports `isDirectory() === false` and `isSymbolicLink() === true` for one, exactly as for
 * a symlink, and `realpath` resolves through it. So on Windows the tests use a junction and
 * actually run. Where neither works they SKIP, which says so in the output instead of
 * passing quietly.
 */
const LINK_TYPE: "junction" | "dir" = process.platform === "win32" ? "junction" : "dir";

const CAN_LINK = (() => {
  const probe = fsSync.mkdtempSync(path.join(os.tmpdir(), "gw-link-probe-"));
  try {
    const target = path.join(probe, "target");
    fsSync.mkdirSync(target);
    fsSync.symlinkSync(target, path.join(probe, "link"), LINK_TYPE);
    return true;
  } catch {
    return false;
  } finally {
    fsSync.rmSync(probe, { recursive: true, force: true });
  }
})();

/** A directory link. Junctions are directory-only, so a file is reached *through* one. */
async function linkDir(target: string, linkPath: string): Promise<void> {
  await fsp.symlink(target, linkPath, LINK_TYPE);
}

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

  it.skipIf(!CAN_LINK)("resolves through a link and stores the real path", async () => {
    const link = path.join(root, "link-to-repo");
    await linkDir(repo, link);

    const info = await validateRepoPath(link, vault);
    expect(info.path).toBe(await fsp.realpath(repo));
    expect(info.path).not.toBe(path.resolve(link));
  });

  it.skipIf(!CAN_LINK)("refuses a link that points into the vault", async () => {
    // The case a lexical nesting check cannot see: the path looks unrelated to the vault
    // and resolves straight into it.
    const link = path.join(root, "looks-like-a-repo");
    await linkDir(vault, link);

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

  it.skipIf(!CAN_LINK)("refuses to follow a link out of the repo", async () => {
    /*
     * The check the lexical one cannot make. `linked/secret.md` is a perfectly ordinary
     * repo-relative path; only the filesystem knows it leaves the repo. Without the
     * realpath re-check this read succeeds and nothing in the request looks wrong.
     *
     * The escape goes through a linked DIRECTORY rather than a linked file, because a
     * junction - the only kind of link this machine can make without elevation - is
     * directory-only. Same code path, same assertion.
     */
    await fsp.writeFile(path.join(vault, "secret.md"), "private", "utf8");
    await linkDir(vault, path.join(repo, "linked"));

    expect(await asyncCode(() => readRepoFile(repo, "linked/secret.md"))).toBe("escapes_root");
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

  it.skipIf(!CAN_LINK)("does not descend into a linked directory", async () => {
    // Following one risks both an escape and an unbounded loop, and no version of
    // "list this project's files" needs it.
    await fsp.writeFile(path.join(vault, "secret.md"), "private", "utf8");
    await linkDir(vault, path.join(repo, "linked"));
    await file("src/a.ts");

    const { files } = await listRepoFiles(repo);
    expect(files).toEqual(["src/a.ts"]);
  });

  it("returns an empty list for an empty repo rather than throwing", async () => {
    expect(await listRepoFiles(repo)).toEqual({ files: [], truncated: false });
  });

  it("walks a subdirectory as its own root", async () => {
    // Renamed from "survives a directory it cannot read", which is not what it did - it
    // listed a perfectly readable subdirectory and the comment described a mechanism the
    // test never reached.
    await file("src/a.ts");
    const { files } = await listRepoFiles(path.join(repo, "src"));
    expect(files).toEqual(["a.ts"]);
  });

  it("skips a path in the walk that is not a readable directory", async () => {
    /*
     * The `catch { continue }` branch, actually exercised. `readdir` on a file throws
     * ENOTDIR, which is the same branch a permission-denied subtree takes - and those are
     * ordinary on a real machine, so one must not fail the whole walk.
     */
    const notADir = await file("plain.txt");
    expect(await listRepoFiles(notADir)).toEqual({ files: [], truncated: false });
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

describe("a reader will not accept an unvalidated root", () => {
  /*
   * `repo` is hand-editable frontmatter, so the connect-time checks do not hold for a
   * stored value. A review pointed the readers at the app's own source with a relative
   * root: `listRepoFiles("lib")` returned 28 files of it, `readRepoFile(vaultDir, ...)`
   * returned a plan, and `describeRepo("lib")` reported "Connected" for a path the user
   * never typed. `path.resolve` on a relative root silently anchors it at the server's cwd.
   *
   * Not reachable in P1, because nothing reads yet. It would have been in P2.
   */
  it("refuses a relative root when walking", async () => {
    expect(await asyncCode(() => listRepoFiles("lib"))).toBe("invalid_repo");
  });

  it("refuses a relative root when reading a file", async () => {
    expect(await asyncCode(() => readRepoFile("lib", "vault.ts"))).toBe("invalid_repo");
  });

  it("refuses a relative root when resolving", () => {
    expect(code(() => resolveInRepo("lib", "vault.ts"))).toBe("invalid_repo");
  });

  it("reports an unusable stored value as absent rather than throwing", async () => {
    // describeRepo renders on a page, so it must never throw - the value being broken is
    // exactly when the user needs to be told.
    expect(await describeRepo("lib")).toEqual({ path: "lib", name: "lib", exists: false });
    expect((await describeRepo("")).exists).toBe(false);
  });

  it("still reports a real absolute directory as present", async () => {
    const status = await describeRepo(repo);
    expect(status.exists).toBe(true);
    expect(status.name).toBe("repo");
  });
});

describe("the read-only guarantee", () => {
  /** Source with comment lines removed, so prose about writing is not mistaken for one. */
  async function codeOf(rel: string): Promise<string> {
    const source = await fsp.readFile(path.join(process.cwd(), rel), "utf8");
    return source
      .split(NL)
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join(NL);
  }

  // Each entry also covers its Sync twin, via the `\w*` in callPattern.
  const WRITES = [
    "writeFile",
    "appendFile",
    "write",
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
    "truncate",
    "open",
  ];

  /**
   * Matches a call whether it is reached through a namespace or by a bare name.
   *
   * The first version required a member call - `\\.\\s*name\\s*\\(` - and a review walked straight
   * through it with `import { writeFile } from "node:fs/promises"` followed by
   * `await writeFile(...)`. That wrote a file into the connected repo, and this test, the
   * fs-boundary gate and tsc were all still green. It matters more here than it would
   * elsewhere, because `scripts/fs-boundary.js` now ALLOWLISTS this file: the string check
   * is the only guard left, and it is the stated basis for the exception in CLAUDE.md.
   *
   * The leading `(?:^|[^.\\w])` still refuses to fire on `truncated` or `linked`, which are
   * identifiers this module legitimately uses.
   */
  function callPattern(name: string): RegExp {
    const B = String.fromCharCode(92);
    /*
     * (?:^|[^\w]) <name> \w* \s* \(
     *
     * The leading class excludes word characters but NOT the dot, so both `fsp.writeFile(`
     * and a bare `writeFile(` match while `safeWriteFile(` does not. An earlier attempt
     * excluded the dot as well, to avoid firing on `truncated` - which was unnecessary,
     * since the trailing `\(` already rules that out, and it silently stopped matching
     * every namespaced call.
     *
     * The `\w*` lets one entry cover its Sync twin: `rm` catches `rmSync(` too.
     */
    return new RegExp("(?:^|[^" + B + "w])" + name + B + "w*" + B + "s*" + B + "(", "m");
  }

  it("makes no writing filesystem call, by namespace or by bare name", async () => {
    const code = await codeOf(path.join("lib", "repo.ts"));
    for (const call of WRITES) {
      expect(callPattern(call).test(code), `lib/repo.ts must not call ${call}()`).toBe(false);
    }
  });

  it("imports from node:fs in exactly the two ways it is allowed to", async () => {
    /*
     * The matcher above is a denylist of names, so a write through some function nobody
     * listed slips past it. This closes that from the other side: the module's only
     * filesystem imports are the type-only one and the promises namespace, so a bare
     * writing function cannot be in scope to be called in the first place.
     */
    const code = await codeOf(path.join("lib", "repo.ts"));
    const imports = code.split(NL).filter((l) => l.includes("node:fs"));

    expect(imports).toEqual([
      'import type { Dirent, Stats } from "node:fs";',
      'import fsp from "node:fs/promises";',
    ]);
  });

  it("would catch a write reached through the namespace", () => {
    expect(callPattern("writeFile").test(`await fsp.writeFile(t, "x", "utf8");`)).toBe(true);
  });

  it("would catch a write reached by a bare name", () => {
    // The exact bypass a review used against the previous matcher.
    expect(callPattern("writeFile").test(`await writeFile(t, "x", "utf8");`)).toBe(true);
  });

  it("would catch a Sync twin without listing it", () => {
    expect(callPattern("rm").test(`fsSync.rmSync(dir, { recursive: true });`)).toBe(true);
    expect(callPattern("mkdir").test(`fsSync.mkdirSync(dir);`)).toBe(true);
  });

  it("does not fire on an unrelated identifier that ends with a call name", () => {
    // `safeWriteFile(` is not `writeFile(`; the leading class stops the match.
    expect(callPattern("writeFile").test(`await safeWriteFile(t);`)).toBe(false);
  });

  it("does not fire on an identifier that merely contains a call name", () => {
    // `truncated` contains "truncate"; `linked` contains "link". Both are legitimate, and
    // a guard that cries wolf on them is a guard someone deletes.
    const sample = `let truncated = false; const linked = queue.shift(); const relinked = 1;`;
    expect(callPattern("truncate").test(sample)).toBe(false);
    expect(callPattern("symlink").test(sample)).toBe(false);
  });
});

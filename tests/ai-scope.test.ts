import path from "node:path";
import { describe, expect, it } from "vitest";

import { assertInstructionScoped, findAbsolutePaths } from "@/lib/ai/scope";
import { isVaultError } from "@/lib/errors";

/**
 * The boundary that keeps a connected repository out of a spawned run's reach.
 *
 * A run's permissions are a denylist anchored at the app root, and `Write` is granted
 * broadly because the CLI does not honour a path-scoped allow rule. So a path outside the
 * app root is not merely unlisted — it is unprotected. The defence is that the run is
 * never told such a path exists, and this is where that claim gets tested.
 */

const ROOT = process.platform === "win32" ? "C:\\app\\groundwork" : "/app/groundwork";
const OUTSIDE = process.platform === "win32" ? "C:\\work\\my-repo" : "/work/my-repo";

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return isVaultError(e) ? e.code : `not-a-vault-error:${String(e)}`;
  }
  return "did-not-throw";
}

describe("findAbsolutePaths", () => {
  it("finds a Windows drive path", () => {
    expect(findAbsolutePaths("read C:\\work\\repo now")).toEqual(["C:\\work\\repo"]);
  });

  it("finds a POSIX absolute path", () => {
    expect(findAbsolutePaths("read /work/repo now")).toEqual(["/work/repo"]);
  });

  it("finds a UNC share", () => {
    expect(findAbsolutePaths("read \\\\server\\share\\repo")).toEqual([
      "\\\\server\\share\\repo",
    ]);
  });

  it("ignores a relative path, which is what every prompt uses today", () => {
    expect(findAbsolutePaths('execute it for the project at "vault/alpha-portal"')).toEqual([]);
    expect(findAbsolutePaths("Read prompts/synthesize.md")).toEqual([]);
    expect(findAbsolutePaths(".groundwork/runs/r1/proposal.json")).toEqual([]);
  });

  it("ignores a URL, which is not a filesystem path", () => {
    // `//` after a scheme must not read as a POSIX root, or every prompt mentioning a
    // doc link would fail to start a run.
    expect(findAbsolutePaths("see https://example.com/docs/a")).toEqual([]);
  });

  it("finds more than one", () => {
    const found = findAbsolutePaths(`read ${OUTSIDE} and ${path.join(ROOT, "lib")}`);
    expect(found.length).toBe(2);
  });
});

describe("assertInstructionScoped", () => {
  it("allows the instructions the app sends today", () => {
    // Every prompt is relative, which is exactly why this guard costs nothing until
    // someone changes that.
    const instruction =
      `Read prompts/synthesize.md and execute it for the project at "vault/alpha-portal". ` +
      `Write your result as JSON to ".groundwork/runs/r1/proposal.json". ` +
      `Do not create, edit or delete any file inside vault/.`;
    expect(code(() => assertInstructionScoped(instruction, ROOT))).toBe("did-not-throw");
  });

  it("allows an absolute path inside the app root", () => {
    // The spawner falls back to an absolute output path when the run directory sits
    // outside cwd. That case is legitimate and must keep working.
    const inside = path.join(ROOT, ".groundwork", "runs", "r1", "proposal.json");
    expect(code(() => assertInstructionScoped(`Write to "${inside}"`, ROOT))).toBe(
      "did-not-throw",
    );
  });

  it("refuses a path outside the app root", () => {
    expect(code(() => assertInstructionScoped(`Read the repo at ${OUTSIDE}`, ROOT))).toBe(
      "escapes_root",
    );
  });

  it("refuses the single edit this guard exists to stop", () => {
    /*
     * The concrete regression: repo-grounded planning lands, and someone adds the
     * connected repo's path to the prompt. One line, entirely reasonable-looking, and it
     * silently hands write access to a user's source tree — because the denylist that
     * scopes a run cannot name anything outside the app root.
     */
    const instruction =
      `Read prompts/synthesize.md and execute it for the project at "vault/alpha-portal". ` +
      `The connected repository is at "${OUTSIDE}" — read its source for context. ` +
      `Write your result as JSON to ".groundwork/runs/r1/proposal.json".`;
    expect(code(() => assertInstructionScoped(instruction, ROOT))).toBe("escapes_root");
  });

  it("names the offending path in the message, so the failure is actionable", () => {
    try {
      assertInstructionScoped(`Read ${OUTSIDE}`, ROOT);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain(OUTSIDE);
      expect((e as Error).message).toContain("lib/repo.ts");
    }
  });

  it("refuses a parent of the app root", () => {
    const parent = path.dirname(ROOT);
    expect(code(() => assertInstructionScoped(`Read ${parent}`, ROOT))).toBe("escapes_root");
  });

  it("refuses a sibling whose name starts with the app root's", () => {
    // A prefix test would let this through; the check uses path.relative instead.
    expect(code(() => assertInstructionScoped(`Read ${ROOT}-backup`, ROOT))).toBe(
      "escapes_root",
    );
  });

  it("allows the app root itself", () => {
    expect(code(() => assertInstructionScoped(`Work in ${ROOT}`, ROOT))).toBe("did-not-throw");
  });
});

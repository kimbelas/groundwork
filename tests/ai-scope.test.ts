import path from "node:path";
import { describe, expect, it } from "vitest";

import { assertInstructionScoped, findOutsidePaths, pathCandidates } from "@/lib/ai/scope";

/**
 * The boundary that keeps a connected repository out of a spawned run's reach.
 *
 * A run's permissions are a denylist anchored at the app root, and `Write` is granted
 * broadly because the CLI does not honour a path-scoped allow rule. So a path outside the
 * app root is not merely unlisted — it is unprotected. The defence is that the run is never
 * told such a path exists, and this is where that claim gets tested.
 */

const WIN = process.platform === "win32";
const ROOT = WIN ? "C:\\app\\groundwork" : "/app/groundwork";
const OUTSIDE = WIN ? "C:\\work\\my-repo" : "/work/my-repo";

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code ?? `not-a-vault-error:${String(e)}`;
  }
  return "did-not-throw";
}

/** The instruction the app actually sends today, which must always be allowed. */
const REAL_INSTRUCTION =
  `Read prompts/synthesize.md and execute it for the project at "vault/alpha-portal". ` +
  `Write your result as JSON to ".groundwork/runs/r1/proposal.json". ` +
  `Do not create, edit or delete any file inside vault/ — the app applies changes only ` +
  `after the user has reviewed them.`;

describe("pathCandidates", () => {
  it("returns the token itself", () => {
    expect(pathCandidates("vault/alpha")).toEqual(["vault/alpha"]);
  });

  it("also returns what follows a colon that is not a drive letter's", () => {
    // `at:${repo}` is the shape that slipped past the pattern this replaced: the token as
    // a whole is relative and harmless-looking, and its tail is an absolute path.
    expect(pathCandidates("at:/work/repo")).toContain("/work/repo");
  });

  it("does not split a drive letter's colon", () => {
    // `C:\x` is one path. Splitting at index 1 would yield a bare `\x` and lose the drive.
    expect(pathCandidates("C:/work/repo")).toEqual(["C:/work/repo"]);
  });

  it("strips trailing sentence punctuation", () => {
    expect(pathCandidates("vault/alpha.")).toEqual(["vault/alpha"]);
    expect(pathCandidates("vault/alpha),")).toEqual(["vault/alpha"]);
  });

  it("skips a web URL whole", () => {
    // Splitting one at its colon leaves `//host/path`, which resolves to a UNC share —
    // so without this every prompt citing a document would refuse to run.
    expect(pathCandidates("https://example.com/docs/a")).toEqual([]);
    expect(pathCandidates("http://example.com/x")).toEqual([]);
  });

  it("still checks a file: URL, which does name a location on disk", () => {
    expect(pathCandidates("file:///work/repo").length).toBeGreaterThan(1);
  });
});

describe("findOutsidePaths", () => {
  it("finds nothing in the instruction the app sends today", () => {
    expect(findOutsidePaths(REAL_INSTRUCTION, ROOT)).toEqual([]);
  });

  /*
   * The four spellings a review found the previous regex missed. Every one of them
   * resolves squarely outside the app root, and the first is the dangerous one: this
   * codebase normalises paths with `.split(path.sep).join("/")`, so a repo on a network
   * share becomes exactly that spelling on its way into a string.
   */
  const BYPASSES: [string, string][] = [
    ["forward-slash UNC", "//server/share/my-repo"],
    ["rooted backslash", "\\work\\my-repo"],
    ["drive-relative", "D:my-repo"],
    ["glued after a label", "at:/work/my-repo"],
    ["glued after a label, with a drive", "at:C:\\work\\my-repo"],
  ];

  for (const [name, spelling] of BYPASSES) {
    it(`catches a ${name} path`, () => {
      expect(findOutsidePaths(`read the repo at ${spelling} now`, ROOT).length).toBeGreaterThan(
        0,
      );
    });
  }

  it("catches traversal out of the root", () => {
    expect(findOutsidePaths("read ../../secrets", ROOT).length).toBeGreaterThan(0);
  });

  it("allows a path inside the root, absolute or relative", () => {
    const inside = path.join(ROOT, ".groundwork", "runs", "r1", "proposal.json");
    expect(findOutsidePaths(`Write to "${inside}"`, ROOT)).toEqual([]);
    expect(findOutsidePaths("Write to .groundwork/runs/r1/proposal.json", ROOT)).toEqual([]);
  });

  it("allows a path explicitly passed through allow", () => {
    /*
     * The run directory can sit outside the checkout — `GROUNDWORK_RUNS` is a supported
     * override — and then the output path handed to the model is absolute and outside.
     * That case is legitimate. An earlier version had no allow list and so refused the
     * very case its own comment called legitimate, which meant no run could start at all.
     */
    const runs = WIN ? "D:\\gw-runs" : "/gw-runs";
    const out = path.join(runs, "r1", "proposal.json");

    expect(findOutsidePaths(`Write to "${out}"`, ROOT).length).toBeGreaterThan(0);
    expect(findOutsidePaths(`Write to "${out}"`, ROOT, { allow: [out] })).toEqual([]);
    expect(findOutsidePaths(`Write to "${out}"`, ROOT, { allow: [runs] })).toEqual([]);
  });

  it("does not let an allow entry cover a sibling of itself", () => {
    // Allowing `/gw-runs` must not allow `/gw-runs-elsewhere`. The containment check uses
    // path.relative, not a string prefix.
    const runs = WIN ? "D:\\gw-runs" : "/gw-runs";
    const sneaky = WIN ? "D:\\gw-runs-elsewhere\\x" : "/gw-runs-elsewhere/x";
    expect(findOutsidePaths(`Write to "${sneaky}"`, ROOT, { allow: [runs] }).length).toBe(1);
  });

  it("reports every offending path, not only the first", () => {
    const found = findOutsidePaths(`read ${OUTSIDE} and also /elsewhere/thing`, ROOT);
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag ordinary prose", () => {
    // Every word in a sentence resolves against the root as a relative path, so a false
    // positive here would refuse a perfectly good prompt.
    expect(
      findOutsidePaths(
        "Read the brief and write cards. Sizes are S/M/L. See e.g. the roadmap.",
        ROOT,
      ),
    ).toEqual([]);
  });
});

describe("assertInstructionScoped", () => {
  it("allows the instruction the app sends today", () => {
    expect(code(() => assertInstructionScoped(REAL_INSTRUCTION, ROOT))).toBe("did-not-throw");
  });

  it("refuses the single edit this guard exists to stop", () => {
    /*
     * The concrete regression: repo-grounded planning lands, and someone adds the
     * connected repo's path to the prompt. One line, entirely reasonable-looking, and it
     * silently hands write access to a user's source tree.
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
    expect(code(() => assertInstructionScoped(`Read ${path.dirname(ROOT)}`, ROOT))).toBe(
      "escapes_root",
    );
  });

  it("refuses a sibling whose name starts with the app root's", () => {
    // A string prefix test would let this through; the check uses path.relative.
    expect(code(() => assertInstructionScoped(`Read ${ROOT}-backup`, ROOT))).toBe(
      "escapes_root",
    );
  });

  it("allows the app root itself", () => {
    expect(code(() => assertInstructionScoped(`Work in ${ROOT}`, ROOT))).toBe("did-not-throw");
  });
});

/**
 * The wire, not the function.
 *
 * A review replaced `assertInstructionScoped(...)` in `lib/ai/claude-cli.ts` with
 * `void assertInstructionScoped;` and the entire suite still passed: 428 green. The check
 * was correct and nothing verified it was installed, which is the same shape of defect as a
 * check that does not check. `prepareRun` exists as a seam so this can be asserted without
 * spawning a process.
 */
/** `lib/runs.ts` validates the shape, so a made-up id fails before the guard is reached. */
const RUN_ID = "run_20260820_0930";

describe("prepareRun — the guard is actually installed", () => {
  it("builds the ordinary instruction without complaint", async () => {
    const { prepareRun } = await import("@/lib/ai/claude-cli");
    const { instruction, outPath } = prepareRun(
      { kind: "synthesize", slug: "alpha-portal" },
      RUN_ID,
      process.cwd(),
    );

    expect(instruction).toContain("vault/alpha-portal");
    // Relative, because a permission rule anchored at the project root cannot match an
    // absolute path — the reason the fallback exists at all.
    expect(path.isAbsolute(outPath)).toBe(false);
  });

  it("refuses a slug that escapes the vault, at the point of spawning", async () => {
    /*
     * A traversal slug is the one input that reaches the instruction and can name
     * somewhere outside the root today. `assertSlug` rejects it far earlier in the real
     * flow, and that is the point: this asserts the *last* line of defence is connected,
     * not that the first one works.
     */
    const { prepareRun } = await import("@/lib/ai/claude-cli");
    expect(
      code(() =>
        prepareRun({ kind: "synthesize", slug: "../../../etc" }, RUN_ID, process.cwd()),
      ),
    ).toBe("escapes_root");
  });

  it("refuses every job kind, not only the first", async () => {
    const { prepareRun } = await import("@/lib/ai/claude-cli");
    const escaping = "../../../etc";

    expect(code(() => prepareRun({ kind: "critique", slug: escaping }, RUN_ID, process.cwd()))).toBe(
      "escapes_root",
    );
    expect(
      code(() =>
        prepareRun({ kind: "enhance-card", slug: escaping, cardId: 1 }, RUN_ID, process.cwd()),
      ),
    ).toBe("escapes_root");
  });
});

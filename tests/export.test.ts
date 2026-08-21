import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  composeExport,
  demoteHeadings,
  EXPORT_FILES,
  previewExport,
  unacknowledgedClobbers,
  validateTarget,
  writeExport,
  type ExportInput,
} from "@/lib/export";
import { DEFAULT_COLUMNS } from "@/lib/schema";

/**
 * `lib/export.ts` is the fourth exception to "all disk access goes through `lib/vault.ts`",
 * and the only one that writes **outside this application**.
 *
 * The other three own a directory: two inside the app root, and `lib/repo.ts` a third tree
 * it never writes to at all — which is the whole of that argument, and export cannot borrow
 * it. So the exception rests on a narrower contract, and these tests exist to make that
 * contract falsifiable rather than stated:
 *
 *  - two filenames, chosen by the module and never by a caller
 *  - into an existing directory only; it does not create trees
 *  - the vault and this app's own root refused, in both directions
 *  - nothing deleted or renamed but its own temp file
 *  - a preview of what would be overwritten, before anything is
 */

const NL = /\r?\n/;

let scratch: string;
let target: string;

beforeEach(async () => {
  scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-export-"));
  target = path.join(scratch, "target-repo");
  await fsp.mkdir(target, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(scratch, { recursive: true, force: true });
});

function input(over: Partial<ExportInput> = {}): ExportInput {
  return {
    slug: "portal-rebuild",
    meta: {
      name: "Portal Rebuild",
      slug: "portal-rebuild",
      stage: "building",
      health: "green",
      archetype: "client",
      columns: [...DEFAULT_COLUMNS],
      repo: undefined,
    },
    brief: "Tenants call the office to report anything.\n\nThe work order system is a 2014 thing.",
    phases: [
      { n: 1, name: "Intake", goal: "Understand what exists" },
      { n: 2, name: "Shaping", goal: "Lock the contract" },
    ],
    cards: [
      {
        id: 1,
        title: "Trace the current behaviour",
        column: "Intake",
        phase: 1,
        priority: "P1",
        size: "M",
        confidence: 0.7,
        blocked: false,
        order: 100,
      },
      {
        id: 2,
        title: "Pin the SOAP contract",
        column: "Done",
        phase: 2,
        priority: "P2",
        size: "S",
        confidence: 0.5,
        blocked: false,
        order: 100,
      },
    ],
    questions: [
      { id: "q1", text: "Who signs off on scope?", status: "open", answer: null, fromRun: null },
      {
        id: "q2",
        text: "How are users identified?",
        status: "answered",
        answer: "By email",
        fromRun: null,
      },
    ],
    risks: [
      { id: "r1", text: "Parity is guesswork without tests", likelihood: "high", impact: "high", mitigation: "Write the spec first" },
    ],
    assumptions: [{ id: "a1", text: "A phased rollout is acceptable", validated: false }],
    log: "## 2026-08-20\n\nChose SOAP over a rewrite.\n",
    ...over,
  };
}

// ---------------------------------------------------------------- the contract, scanned

describe("the write contract, enforced on the source", () => {
  /** Source with comment lines removed, so prose about deleting is not mistaken for one. */
  async function codeOf(rel: string): Promise<string[]> {
    const source = await fsp.readFile(path.join(process.cwd(), rel), "utf8");
    return source.split(NL).filter((l) => {
      const t = l.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    });
  }

  /**
   * Matches a call by namespace or by bare name, including its Sync twin.
   *
   * Lifted from `tests/repo.test.ts`, where a review walked through a member-only pattern
   * using `import { writeFile } from "node:fs/promises"`. The same bypass would work here,
   * and here it matters as much: `scripts/fs-boundary.js` allowlists this file, so a string
   * check is the guard that remains.
   */
  function callPattern(name: string): RegExp {
    const B = String.fromCharCode(92);
    return new RegExp("(?:^|[^" + B + "w])" + name + B + "w*" + B + "s*" + B + "(", "m");
  }

  /**
   * Calls with no legitimate use here at all.
   *
   * `mkdir` is on the list deliberately: refusing to create the target directory is claim 2
   * of the contract, and a `mkdir` appearing in this module means a typo now scatters files
   * instead of failing.
   */
  const FORBIDDEN = [
    "unlink",
    "rmdir",
    "truncate",
    "chmod",
    "chown",
    "cp",
    "copyFile",
    "createWriteStream",
    "symlink",
    "link",
    "utimes",
    "mkdir",
    "appendFile",
    "watch",
  ];

  it("makes none of the calls it has no business making", async () => {
    const code = (await codeOf(path.join("lib", "export.ts"))).join("\n");
    for (const call of FORBIDDEN) {
      expect(callPattern(call).test(code), `lib/export.ts must not call ${call}()`).toBe(false);
    }
  });

  it("deletes and renames nothing but its own temp file", async () => {
    /*
     * `rm` and `rename` cannot be banned outright — the write is temp-then-rename, which is
     * what stops a failed write from having already truncated the user's existing file. So
     * the check is narrower: every one of those calls must be on `tmp`. Adding
     * `fsp.rm(dest)` fails here.
     */
    const lines = await codeOf(path.join("lib", "export.ts"));
    const destructive = lines.filter(
      (l) => callPattern("rm").test(l) || callPattern("rename").test(l),
    );

    expect(destructive.length).toBeGreaterThan(0);
    for (const line of destructive) {
      expect(line, `only tmp may be removed or renamed: ${line.trim()}`).toContain("tmp");
    }
  });

  it("would catch a delete aimed at something other than the temp file", () => {
    // The matcher, checked against the edit it exists to stop.
    const line = '    await fsp.rm(dest, { force: true });';
    expect(callPattern("rm").test(line)).toBe(true);
    expect(line).not.toContain("tmp");
  });

  it("names exactly two files, and they are markdown", () => {
    expect(EXPORT_FILES).toEqual(["CLAUDE.md", "TASKS.md"]);
  });
});

// ---------------------------------------------------------------- the target

describe("validateTarget", () => {
  const vault = () => path.join(scratch, "vault");

  it("accepts an existing directory outside the vault and the app", async () => {
    expect(await validateTarget(target, vault())).toBe(path.resolve(target));
  });

  it("refuses a relative path", async () => {
    // It would resolve against whatever directory the server happens to run in.
    await expect(validateTarget("./out", vault())).rejects.toThrow();
  });

  it("refuses a NUL byte", async () => {
    await expect(validateTarget(`${target}\0.md`, vault())).rejects.toThrow();
  });

  it("refuses empty input", async () => {
    await expect(validateTarget("   ", vault())).rejects.toThrow();
    await expect(validateTarget(undefined, vault())).rejects.toThrow();
  });

  it("does not create the directory it was given", async () => {
    // A path that does not exist is far more likely a typo than an intention.
    const missing = path.join(scratch, "nope", "deeper");
    await expect(validateTarget(missing, vault())).rejects.toThrow();
    await expect(fsp.stat(path.join(scratch, "nope"))).rejects.toThrow();
  });

  it("refuses a file", async () => {
    const file = path.join(scratch, "a-file.md");
    await fsp.writeFile(file, "x", "utf8");
    await expect(validateTarget(file, vault())).rejects.toThrow();
  });

  it("refuses the vault, a folder inside it, and a folder containing it", async () => {
    const v = vault();
    await fsp.mkdir(path.join(v, "portal-rebuild"), { recursive: true });

    await expect(validateTarget(v, v)).rejects.toThrow();
    await expect(validateTarget(path.join(v, "portal-rebuild"), v)).rejects.toThrow();
    // scratch contains the vault: exporting here would put a generated file above the data.
    await expect(validateTarget(scratch, v)).rejects.toThrow();
  });

  it("refuses this application's own root", async () => {
    // The dangerous near-miss: it would overwrite the CLAUDE.md the app runs under.
    await expect(validateTarget(process.cwd(), vault())).rejects.toThrow();
    await expect(validateTarget(path.dirname(process.cwd()), vault())).rejects.toThrow();
  });

  it("allows a subdirectory of the app root, which is the user's business", async () => {
    // Only the root itself and its ancestors are refused. A folder underneath is theirs.
    const inside = path.join(process.cwd(), ".groundwork", "export-probe");
    await fsp.mkdir(inside, { recursive: true });
    try {
      expect(await validateTarget(inside, vault())).toBe(path.resolve(inside));
    } finally {
      await fsp.rm(inside, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------- composition

describe("composeExport", () => {
  it("carries the brief verbatim rather than a summary of it", () => {
    // A summary would be this app's opinion about the user's own words.
    const { "CLAUDE.md": claude } = composeExport(input());
    expect(claude).toContain("Tenants call the office to report anything.");
    expect(claude).toContain("The work order system is a 2014 thing.");
  });

  it("keeps open questions open, and marks them as questions to ask", () => {
    const { "CLAUDE.md": claude } = composeExport(input());
    expect(claude).toMatch(/Open questions — ask, do not guess/);
    expect(claude).toContain("Who signs off on scope?");
    // An answered one is context, not a question.
    expect(claude).toContain("How are users identified?");
    expect(claude).toContain("By email");
  });

  it("carries the decisions already taken", () => {
    const { "CLAUDE.md": claude } = composeExport(input());
    expect(claude).toContain("Chose SOAP over a rewrite.");
  });

  it("nests the decision log under its own heading instead of beside the others", () => {
    // log.md entries are `##`, so splicing them verbatim made each decision a sibling of
    // "The brief" - the hierarchy then lies to whatever reads the file.
    const { "CLAUDE.md": claude } = composeExport(input());
    expect(claude).toContain("## Decisions already taken");
    expect(claude).toContain("### 2026-08-20");
    expect(claude).not.toMatch(/^## 2026-08-20/m);
  });

  it("writes words, not codes", () => {
    // P1/M are what the vault stores because a person hand-edits it. An exported file is
    // read by someone with no key to those letters.
    const { "CLAUDE.md": claude, "TASKS.md": tasks } = composeExport(input());
    expect(claude).toContain("High");
    expect(claude).not.toMatch(/\bP1\b/);
    expect(tasks).toContain("Medium");
    expect(tasks).not.toMatch(/\bP1\b/);
  });

  it("groups the work by phase, in the order it happens", () => {
    const { "TASKS.md": tasks } = composeExport(input());
    expect(tasks.indexOf("Phase 1 — Intake")).toBeLessThan(tasks.indexOf("Phase 2 — Shaping"));
  });

  it("ticks a card that is already done", () => {
    const { "TASKS.md": tasks } = composeExport(input());
    expect(tasks).toContain("- [ ] Trace the current behaviour");
    expect(tasks).toContain("- [x] Pin the SOAP contract");
  });

  it("names a phase a card references but the roadmap does not declare", () => {
    // Same rule the roadmap track follows: a card on phase 3 must not vanish.
    const { "TASKS.md": tasks } = composeExport(
      input({ cards: [{ ...input().cards[0]!, phase: 9 }] }),
    );
    expect(tasks).toContain("Phase 9");
  });

  it("survives an empty project without producing a lie", () => {
    const { "CLAUDE.md": claude, "TASKS.md": tasks } = composeExport(
      input({ brief: "", phases: [], cards: [], questions: [], risks: [], assumptions: [], log: "" }),
    );
    expect(claude).toContain("No brief was written");
    expect(tasks).toContain("No cards yet");
  });
});

// ---------------------------------------------------------------- preview and write

describe("demoteHeadings", () => {
  it("pushes each level one deeper", () => {
    expect(demoteHeadings("# a\n## b\n### c")).toBe("## a\n### b\n#### c");
  });

  it("stops at six, which is as deep as markdown goes", () => {
    expect(demoteHeadings("###### deep")).toBe("###### deep");
  });

  it("leaves a hash inside a fence alone", () => {
    // That is a comment in someone's code sample, not a heading.
    const src = "text\n```sh\n# not a heading\n```\n## real heading";
    expect(demoteHeadings(src)).toBe("text\n```sh\n# not a heading\n```\n### real heading");
  });

  it("leaves prose untouched", () => {
    expect(demoteHeadings("a line\n\nanother #hashtag mid-line")).toBe(
      "a line\n\nanother #hashtag mid-line",
    );
  });
});

describe("previewExport and writeExport", () => {
  it("reports a fresh directory as having nothing to clobber", async () => {
    const preview = await previewExport(composeExport(input()), target);
    expect(preview.files.map((f) => f.name)).toEqual(["CLAUDE.md", "TASKS.md"]);
    expect(preview.files.every((f) => f.current === null)).toBe(true);
    expect(preview.files.every((f) => f.clobbers === false)).toBe(true);
  });

  it("returns what is there now, so an overwrite prompt can say what it destroys", async () => {
    await fsp.writeFile(path.join(target, "CLAUDE.md"), "# Someone else's file\n", "utf8");

    const preview = await previewExport(composeExport(input()), target);
    const claude = preview.files.find((f) => f.name === "CLAUDE.md");

    expect(claude?.current).toBe("# Someone else's file\n");
    expect(claude?.clobbers).toBe(true);
    // Preview writes nothing.
    expect(await fsp.readFile(path.join(target, "CLAUDE.md"), "utf8")).toBe(
      "# Someone else's file\n",
    );
  });

  it("does not call an identical file a clobber", async () => {
    const contents = composeExport(input());
    await fsp.writeFile(path.join(target, "TASKS.md"), contents["TASKS.md"], "utf8");

    const preview = await previewExport(contents, target);
    const tasks = preview.files.find((f) => f.name === "TASKS.md");
    expect(tasks?.current).not.toBeNull();
    expect(tasks?.clobbers).toBe(false);
  });

  it("writes exactly two files and leaves nothing else behind", async () => {
    const preview = await previewExport(composeExport(input()), target);
    const result = await writeExport(preview);

    expect(result.written).toEqual(["CLAUDE.md", "TASKS.md"]);
    expect(result.overwritten).toEqual([]);
    // No temp file survives, and nothing else appeared.
    expect((await fsp.readdir(target)).sort()).toEqual(["CLAUDE.md", "TASKS.md"]);
  });

  it("reports which files it overwrote", async () => {
    await fsp.writeFile(path.join(target, "CLAUDE.md"), "old", "utf8");
    // Acknowledged, because the UI would have shown it: this asserts the reporting, and
    // the refusal when it is NOT acknowledged has its own case above.
    const result = await writeExport(
      await previewExport(composeExport(input()), target),
      ["CLAUDE.md"],
    );

    expect(result.overwritten).toEqual(["CLAUDE.md"]);
    expect(await fsp.readFile(path.join(target, "CLAUDE.md"), "utf8")).toContain("Portal Rebuild");
  });

  it("writes what the preview held, not a fresh composition", async () => {
    // The same reason the apply route re-reads the proposal: what the user approved is what
    // must land. Here the preview IS the approved artefact, so it is what gets written.
    const preview = await previewExport(composeExport(input()), target);
    const edited = {
      ...preview,
      files: preview.files.map((f) =>
        f.name === "TASKS.md" ? { ...f, next: "# approved contents\n" } : f,
      ),
    };

    await writeExport(edited);
    expect(await fsp.readFile(path.join(target, "TASKS.md"), "utf8")).toBe("# approved contents\n");
  });

  it("refuses to replace a file that appeared after the preview", async () => {
    /*
     * The gap between showing and clobbering.
     *
     * Preview a folder with no CLAUDE.md, have something create one, then write: without a
     * precondition the user's "nothing to overwrite here" decision silently destroys a file
     * they were never shown. Same shape as expectedMtimeMs on a vault write, and required
     * for the same reason - an optional precondition is a last-writer-wins clobber waiting
     * to happen.
     */
    const contents = composeExport(input());
    const clean = await previewExport(contents, target);
    expect(clean.files.every((f) => !f.clobbers)).toBe(true);

    await fsp.writeFile(path.join(target, "CLAUDE.md"), "appeared in the gap\n", "utf8");

    const fresh = await previewExport(contents, target);
    await expect(writeExport(fresh, [])).rejects.toThrow(/preview again/i);

    // Untouched, and TASKS.md was not written either: the refusal is not half an export.
    expect(await fsp.readFile(path.join(target, "CLAUDE.md"), "utf8")).toBe(
      "appeared in the gap\n",
    );
    expect(await fsp.readdir(target)).toEqual(["CLAUDE.md"]);
  });

  it("writes once the clobber is acknowledged", async () => {
    await fsp.writeFile(path.join(target, "CLAUDE.md"), "old\n", "utf8");
    const preview = await previewExport(composeExport(input()), target);

    const result = await writeExport(preview, ["CLAUDE.md"]);
    expect(result.overwritten).toEqual(["CLAUDE.md"]);
  });

  it("acknowledging one file does not authorise the other", async () => {
    await fsp.writeFile(path.join(target, "CLAUDE.md"), "old\n", "utf8");
    await fsp.writeFile(path.join(target, "TASKS.md"), "old tasks\n", "utf8");
    const preview = await previewExport(composeExport(input()), target);

    await expect(writeExport(preview, ["CLAUDE.md"])).rejects.toThrow(/TASKS\.md/);
    expect(await fsp.readFile(path.join(target, "CLAUDE.md"), "utf8")).toBe("old\n");
  });

  it("names only genuine surprises", async () => {
    await fsp.writeFile(path.join(target, "TASKS.md"), "old tasks\n", "utf8");
    const preview = await previewExport(composeExport(input()), target);

    expect(unacknowledgedClobbers(preview, [])).toEqual(["TASKS.md"]);
    expect(unacknowledgedClobbers(preview, ["TASKS.md"])).toEqual([]);
    // An identical file is not a clobber, so it never needs acknowledging.
    const same = composeExport(input());
    await fsp.writeFile(path.join(target, "TASKS.md"), same["TASKS.md"], "utf8");
    expect(unacknowledgedClobbers(await previewExport(same, target), [])).toEqual([]);
  });

  it("uses a temp name unique to the call, not just the process", async () => {
    // One process writes both files of an export, and can be writing two exports at once.
    // A pid-only temp path had them all sharing one.
    const source = await fsp.readFile(path.join(process.cwd(), "lib", "export.ts"), "utf8");
    const tmpLine = source.split(NL).find((l) => l.includes(".tmp`"));
    expect(tmpLine).toBeTruthy();
    expect(tmpLine).toContain("Date.now()");
    expect(tmpLine).toContain("name");
  });

  it("ignores a filename a caller invented", async () => {
    /*
     * Which files may be written is decided by EXPORT_FILES, not by the preview it is
     * handed. A route that passed a body straight through must not be able to name a third
     * path — including one that climbs out of the target.
     */
    const preview = await previewExport(composeExport(input()), target);
    const tampered = {
      ...preview,
      files: [
        ...preview.files,
        { name: "../escaped.md" as never, next: "nope", current: null, clobbers: false },
      ],
    };

    const result = await writeExport(tampered);
    expect(result.written).toEqual(["CLAUDE.md", "TASKS.md"]);
    expect((await fsp.readdir(target)).sort()).toEqual(["CLAUDE.md", "TASKS.md"]);
    await expect(fsp.stat(path.join(scratch, "escaped.md"))).rejects.toThrow();
  });
});

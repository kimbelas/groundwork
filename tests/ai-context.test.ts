import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CodeChunk } from "@/lib/index/chunk";
import { DIMS, MODEL } from "@/lib/index/embeddings";
import type { Hit } from "@/lib/index/retrieve";
import { INDEX_VERSION, type Manifest } from "@/lib/index/store";

/**
 * The excerpts a run is allowed to read, and the four ways there are none.
 *
 * Two claims here are load-bearing and the rest is arithmetic:
 *
 *  - **The excerpt file never names the repository.** It is the one file the model is told
 *    to read, so a repo path inside it hands over exactly what the whole design withholds —
 *    and unlike an instruction, nothing asserts on it at spawn time. This is where that is
 *    checked.
 *  - **Nothing here can fail a run.** Repo grounding improves a run; it is not a
 *    precondition for one. Every degradation returns a status and prose, and the run
 *    proceeds on the brief alone exactly as it did before P2.
 *
 * The index is written keyword-only on purpose: gating this on the embedding model would
 * mean the unit suite downloading hundreds of megabytes, and search is specified to work
 * without it.
 */

let dir: string;
let ctx: typeof import("@/lib/ai/context");
let runs: typeof import("@/lib/runs");
let store: typeof import("@/lib/index/store");

const SLUG = "portal-rebuild";
const RUN_ID = "run_20260821_0900";
const REPO = process.platform === "win32" ? "C:\\work\\portal" : "/work/portal";
/** Built rather than written inline, so an editor cannot normalise these fixtures. */
const NEWLINE = String.fromCharCode(10);
/** A three-backtick fence, built so this file never contains a bare one. */
const F3 = String.fromCharCode(96).repeat(3);

const BRIEF = `The board loses a card's position when two people drag at once.

## What we know

Writes carry the mtime they loaded, and a stale one is a conflict.

## What we don't

Whether the ordering arithmetic belongs on the client.
`;

async function writeVault(rel: string, contents: string): Promise<void> {
  const full = path.join(dir, "vault", rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, contents, "utf8");
}

function project(over: { repo?: string } = {}): string {
  return `---
name: Portal Rebuild
slug: ${SLUG}
stage: shaping
health: amber
archetype: client
columns: [Intake, Shaping, Done]
${over.repo ? `repo: ${JSON.stringify(over.repo)}\n` : ""}---

${BRIEF}`;
}

function chunk(file: string, start: number, text: string): CodeChunk {
  const lines = text.split("\n").length;
  return { id: `${file}:${start}-${start + lines - 1}`, file, startLine: start, endLine: start + lines - 1, text };
}

function manifest(chunks: CodeChunk[], repo: string): Manifest {
  return {
    version: INDEX_VERSION,
    repo,
    gitSha: null,
    model: MODEL,
    dims: DIMS,
    keywordOnly: true,
    builtAt: "2026-08-21T09:00:00.000Z",
    files: Object.fromEntries(
      [...new Set(chunks.map((c) => c.file))].map((f) => [f, { hash: "h", chunks: 1 }]),
    ),
    chunkCount: chunks.length,
  };
}

async function writeIndexFor(chunks: CodeChunk[], repo = REPO): Promise<void> {
  await store.writeIndex(SLUG, {
    manifest: manifest(chunks, repo),
    chunks,
    vectors: new Float32Array(0),
  });
}

const ORDERING = chunk(
  "lib/ordering.ts",
  40,
  "export function orderFor(cards: Card[], index: number): number {\n  // sparse integers, renumber on collision\n  return 100 * (index + 1);\n}",
);

const CONFLICT = chunk(
  "app/api/cards/route.ts",
  12,
  "if (body.expectedMtimeMs !== current.mtimeMs) {\n  throw new VaultError('conflict', 'The card changed on disk');\n}",
);

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-ctx-"));
  process.env.GROUNDWORK_VAULT = path.join(dir, "vault");
  process.env.GROUNDWORK_INDEX = path.join(dir, "index");
  process.env.GROUNDWORK_RUNS = path.join(dir, "runs");
  vi.resetModules();
  ctx = await import("@/lib/ai/context");
  runs = await import("@/lib/runs");
  store = await import("@/lib/index/store");
});

afterEach(async () => {
  delete process.env.GROUNDWORK_VAULT;
  delete process.env.GROUNDWORK_INDEX;
  delete process.env.GROUNDWORK_RUNS;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("briefQueries", () => {
  it("takes the name, the headings, then the line under each heading", () => {
    const q = ctx.briefQueries("Portal Rebuild", BRIEF);
    expect(q[0]).toBe("Portal Rebuild");
    expect(q.slice(1, 3)).toEqual(["What we know", "What we don't"]);
    expect(q).toContain("Writes carry the mtime they loaded, and a stale one is a conflict.");
  });

  it("still finds queries in a brief with no headings at all", () => {
    // The five-line vague brief is the case this app exists for, so the fallback path is
    // the common path rather than an edge case.
    const q = ctx.briefQueries("Rates", "Agencies count words differently.\nWe invoice monthly.");
    expect(q).toEqual(["Rates", "Agencies count words differently.", "We invoice monthly."]);
  });

  it("caps, dedupes case-insensitively and drops what is too short to search for", () => {
    const brief = "Ordering\nordering\nok\n" + Array.from({ length: 9 }, (_, i) => `line ${i}`).join("\n");
    const q = ctx.briefQueries("Portal", brief, 4);
    expect(q).toHaveLength(4);
    expect(q).toEqual(["Portal", "Ordering", "line 0", "line 1"]);
  });
});

describe("cardQueries", () => {
  it("puts acceptance criteria ahead of body prose", () => {
    const body = "Some context about the board.\n\n- [ ] Two agencies produce different rates\n- [x] A stale write is rejected\n";
    const q = ctx.cardQueries("Rate engine", body);
    expect(q).toEqual([
      "Rate engine",
      "Two agencies produce different rates",
      "A stale write is rejected",
      "Some context about the board.",
    ]);
  });
});

describe("redactRepoPath", () => {
  it("removes both spellings, case-insensitively", () => {
    const text = `see C:\\work\\Portal\\src and C:/WORK/portal/docs`;
    const out = ctx.redactRepoPath(text, "C:\\work\\portal");
    expect(out).toBe("see <repo>\\src and <repo>/docs");
    expect(out.toLowerCase()).not.toContain("work");
  });
});

describe("composeExcerpts", () => {
  const hit = (c: CodeChunk): Hit => ({ chunk: c, via: "keyword" });

  it("heads each excerpt with the citation the grounding check will look for", () => {
    const { text, used } = ctx.composeExcerpts([hit(ORDERING)], REPO);
    expect(used).toBe(1);
    expect(text).toContain("## lib/ordering.ts:40-43");
    expect(text).toContain("return 100 * (index + 1);");
  });

  it("fences longer than any backtick run inside the excerpt", () => {
    const md = chunk("README.md", 1, "Use ```ts fences``` in docs.");
    const { text } = ctx.composeExcerpts([hit(md)], REPO);
    expect(text).toContain("````\nUse ```ts fences``` in docs.\n````");
  });

  it("stops at MAX_EXCERPTS and says how many it dropped", () => {
    const many = Array.from({ length: ctx.MAX_EXCERPTS + 3 }, (_, i) =>
      hit(chunk(`src/f${i}.ts`, 1, `const a${i} = ${i};`)),
    );
    const { text, used } = ctx.composeExcerpts(many, REPO);
    expect(used).toBe(ctx.MAX_EXCERPTS);
    expect(text).toContain("3 further excerpts matched but did not fit.");
  });

  it("holds the byte ceiling", () => {
    // Six chunks of 4 KB against a 16 KB budget: some get in, some do not, and the file
    // stays inside the bound. Asserted as a bound rather than a count, because the rule is
    // "skip what does not fit and keep going" - a later, smaller excerpt may still land.
    const big = Array.from({ length: 6 }, (_, i) =>
      hit(chunk(`src/big${i}.ts`, 1, "x".repeat(4000))),
    );
    const { text, used } = ctx.composeExcerpts(big, REPO);

    expect(used).toBeGreaterThan(1);
    expect(used).toBeLessThan(6);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(ctx.MAX_EXCERPT_BYTES);
  });

  it("always takes the first excerpt, even one larger than the whole budget", () => {
    // Otherwise an index that searched successfully reports "no code found", which reads
    // as "your repo has nothing about this" rather than "one chunk was long".
    const huge = hit(chunk("src/huge.ts", 1, "y".repeat(ctx.MAX_EXCERPT_BYTES * 2)));
    expect(ctx.composeExcerpts([huge], REPO).used).toBe(1);
  });
});

/**
 * The format, written and read back by the same rules.
 *
 * This suite exists because those rules lived in two places and disagreed. The writer
 * fenced each excerpt with a run of backticks longer than anything in the content; the
 * verifier cut each excerpt at the next `## ` line. Both looked reasonable. Then a real run
 * retrieved a README, whose own subheadings are `## ` at the start of a line, and ten
 * citations that were genuinely inside the excerpt came back "ungrounded" — the precise
 * failure the design calls worse than not checking at all.
 */
describe("the excerpt format round-trips", () => {
  const hit = (c: CodeChunk): Hit => ({ chunk: c, via: "keyword" });

  it("reads back an excerpt whose content is full of markdown headings", () => {
    const readme = chunk(
      "README.md",
      1,
      [
        "# Claude Coach",
        "",
        "A local-only coach.",
        "",
        "## Run it",
        "",
        "Double-click coach.cmd.",
        "",
        "## Layout",
        "",
        "Every coaching report, kept, so progress is visible over time.",
      ].join(NEWLINE),
    );

    const { text } = ctx.composeExcerpts([hit(readme)], REPO);
    const body = ctx.excerptBodyFor(text, "README.md:1-11");

    expect(body).not.toBeNull();
    // The whole excerpt, not the first few lines of it.
    expect(body).toContain("Every coaching report, kept");
    expect(body).toContain("## Layout");
  });

  it("reads back an excerpt containing its own code fences", () => {
    const doc = chunk("docs/x.md", 5, ["Use this:", F3 + "ts", "const a = 1;", F3, "done."].join(NEWLINE));
    const { text } = ctx.composeExcerpts([hit(doc)], REPO);

    expect(ctx.excerptBodyFor(text, "docs/x.md:5-9")).toContain("const a = 1;");
  });

  it("keeps two excerpts apart", () => {
    // The boundary has to hold in the direction that matters too: a quote from excerpt B
    // must not verify against a citation of excerpt A.
    const { text } = ctx.composeExcerpts([hit(ORDERING), hit(CONFLICT)], REPO);

    const first = ctx.excerptBodyFor(text, "lib/ordering.ts:40-43") ?? "";
    expect(first).toContain("orderFor");
    expect(first).not.toContain("expectedMtimeMs");
  });

  it("returns null for a citation the file does not carry", () => {
    const { text } = ctx.composeExcerpts([hit(ORDERING)], REPO);
    expect(ctx.excerptBodyFor(text, "lib/ordering.ts:1-9")).toBeNull();
    expect(ctx.excerptBodyFor(text, "nowhere.ts:1-2")).toBeNull();
  });

  it("returns null rather than the neighbour when a fence is missing", () => {
    // A truncated file must verify nothing, not verify everything.
    const broken = "# Repository excerpts" + NEWLINE + NEWLINE + "## a.ts:1-2" + NEWLINE + NEWLINE + "## b.ts:3-4" + NEWLINE + NEWLINE + F3 + NEWLINE + "real" + NEWLINE + F3 + NEWLINE;
    expect(ctx.excerptBodyFor(broken, "a.ts:1-2")).toBeNull();
  });
});

describe("one oversized hit does not starve the rest", () => {
  const hit = (c: CodeChunk): Hit => ({ chunk: c, via: "keyword" });

  it("skips what does not fit and keeps going", () => {
    /*
     * Measured on a real repository: the top hit was a 6.8 KB README, the budget was 6 KB,
     * and the composer stopped there - so the run received a README and no source at all.
     * One long hit must cost itself, not everything behind it.
     */
    const huge = hit(chunk("README.md", 1, "x".repeat(Math.floor(ctx.MAX_EXCERPT_BYTES * 0.9))));
    const small = Array.from({ length: 5 }, (_, i) =>
      hit(chunk(`src/f${i}.ts`, 1, `export const a${i} = ${i};`)),
    );

    const { used } = ctx.composeExcerpts([huge, ...small], REPO);
    expect(used).toBeGreaterThan(1);
  });

  it("still takes the first even when it alone exceeds the budget", () => {
    const huge = hit(chunk("big.ts", 1, "y".repeat(ctx.MAX_EXCERPT_BYTES * 2)));
    const { used, text } = ctx.composeExcerpts([huge, hit(ORDERING)], REPO);
    expect(used).toBe(1);
    expect(text).toContain("## big.ts:1-1");
  });
});

describe("buildRepoContext", () => {
  it("says so when no repository is connected, and writes nothing", async () => {
    await writeVault(`${SLUG}/project.md`, project());
    const result = await ctx.buildRepoContext({ kind: "synthesize", slug: SLUG }, RUN_ID);

    expect(result.status).toBe("no-repo");
    expect(result.included).toBe(false);
    expect(result.reason).toMatch(/brief only/i);
    expect(await runs.readExcerpts(RUN_ID)).toBeNull();
    expect(runs.hasExcerpts(RUN_ID)).toBe(false);
  });

  it("says so when the repository has never been indexed", async () => {
    await writeVault(`${SLUG}/project.md`, project({ repo: REPO }));
    const result = await ctx.buildRepoContext({ kind: "synthesize", slug: SLUG }, RUN_ID);

    expect(result.status).toBe("no-index");
    expect(result.reason).toMatch(/indexed/i);
    expect(runs.hasExcerpts(RUN_ID)).toBe(false);
  });

  it("refuses an index built from a different repository", async () => {
    // A reconnected project whose index still holds the old repo's code would quote files
    // that are not in the repository the user is now planning against.
    await writeVault(`${SLUG}/project.md`, project({ repo: REPO }));
    const other = process.platform === "win32" ? "C:\\work\\other" : "/work/other";
    await writeIndexFor([ORDERING], other);

    const result = await ctx.buildRepoContext({ kind: "synthesize", slug: SLUG }, RUN_ID);
    expect(result.status).toBe("stale-index");
    expect(result.reason).toMatch(/rebuild/i);
    expect(runs.hasExcerpts(RUN_ID)).toBe(false);
  });

  it("accepts the same repository spelled differently", async () => {
    const shouted = process.platform === "win32" ? "C:\\work\\..\\work\\Portal" : "/work/../work/portal";
    await writeVault(`${SLUG}/project.md`, project({ repo: shouted }));
    await writeIndexFor([ORDERING, CONFLICT]);

    const result = await ctx.buildRepoContext({ kind: "synthesize", slug: SLUG }, RUN_ID);
    // Case-insensitive on Windows, traversal-collapsing everywhere.
    expect(result.status).toBe("included");
  });

  it("writes excerpts and reports keyword-only retrieval as such", async () => {
    await writeVault(`${SLUG}/project.md`, project({ repo: REPO }));
    await writeIndexFor([ORDERING, CONFLICT]);

    const result = await ctx.buildRepoContext({ kind: "synthesize", slug: SLUG }, RUN_ID);

    expect(result.status).toBe("included");
    expect(result.included).toBe(true);
    expect(result.excerpts).toBeGreaterThan(0);
    expect(result.semantic).toBe(false);
    // Silence here would let a user believe their code was searched semantically.
    expect(result.reason).toBeTruthy();

    const written = await runs.readExcerpts(RUN_ID);
    expect(written).toContain("app/api/cards/route.ts:12-14");
    expect(written).toMatch(/only part of that repository/i);
  });

  it("never names the repository in the file the run is told to read", async () => {
    // A repo can contain its own absolute path — a committed config, a log, a comment —
    // and that file is a legitimate retrieval hit.
    await writeVault(`${SLUG}/project.md`, project({ repo: REPO }));
    const leaky = chunk(
      "scripts/build.log",
      1,
      `mtime conflict resolved in ${REPO}\\src while ordering cards`,
    );
    await writeIndexFor([leaky, ORDERING]);

    await ctx.buildRepoContext({ kind: "synthesize", slug: SLUG }, RUN_ID);
    const written = (await runs.readExcerpts(RUN_ID)) ?? "";

    expect(written).toContain("<repo>");
    for (const spelling of [REPO, REPO.split("\\").join("/")]) {
      expect(written.toLowerCase()).not.toContain(spelling.toLowerCase());
    }
    expect(written).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("says so when the index has nothing to say about this project", async () => {
    await writeVault(`${SLUG}/project.md`, project({ repo: REPO }));
    await writeIndexFor([chunk("src/unrelated.ts", 1, "zzqq wwxx yyvv")]);

    const result = await ctx.buildRepoContext({ kind: "synthesize", slug: SLUG }, RUN_ID);
    expect(result.status).toBe("no-hits");
    expect(runs.hasExcerpts(RUN_ID)).toBe(false);
  });

  it("searches a card's own text when enhancing one", async () => {
    await writeVault(`${SLUG}/project.md`, project({ repo: REPO }));
    await writeVault(
      `${SLUG}/cards/0001-ordering.md`,
      `---\nid: 1\ntitle: Sparse ordering\ncolumn: Shaping\n---\n\n- [ ] orderFor renumbers on collision\n`,
    );
    await writeIndexFor([ORDERING, CONFLICT]);

    const result = await ctx.buildRepoContext(
      { kind: "enhance-card", slug: SLUG, cardId: 1 },
      RUN_ID,
    );

    expect(result.status).toBe("included");
    expect(await runs.readExcerpts(RUN_ID)).toContain("lib/ordering.ts:40-43");
  });

  it("degrades instead of throwing when the project cannot be read at all", async () => {
    // The rule is lib/git.ts's: this layer reports a reason, it never fails a run.
    const result = await ctx.buildRepoContext({ kind: "synthesize", slug: "no-such-project" }, RUN_ID);
    expect(result.status).toBe("unavailable");
    expect(result.included).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

import { describe, expect, it } from "vitest";

import { hashText, planBuild } from "@/lib/index/build";
import { chunkFile } from "@/lib/index/chunk";
import { DIMS, MODEL } from "@/lib/index/embeddings";
import { INDEX_VERSION, type Manifest } from "@/lib/index/store";

/**
 * The incremental rule, tested as pure arithmetic.
 *
 * Embedding is the only operation in this app that costs real time, so the whole value of
 * the index layer is in not doing it twice. `planBuild` is the decision, split out from the
 * work so it can be checked without a repository, a model, or a filesystem.
 */

const NL = String.fromCharCode(10);

function scanned(files: Record<string, string>): Map<string, { text: string; hash: string }> {
  return new Map(
    Object.entries(files).map(([rel, text]) => [rel, { text, hash: hashText(text) }]),
  );
}

function manifest(files: Record<string, { hash: string; chunks: number }>): Manifest {
  return {
    version: INDEX_VERSION,
    repo: "C:/work/repo",
    gitSha: "sha-1",
    model: MODEL,
    dims: DIMS,
    keywordOnly: false,
    builtAt: "2026-08-20T09:00:00.000Z",
    files,
    chunkCount: Object.values(files).reduce((n, f) => n + f.chunks, 0),
  };
}

/** What the previous manifest would have recorded for this exact content. */
function recordFor(rel: string, text: string): { hash: string; chunks: number } {
  return { hash: hashText(text), chunks: chunkFile(rel, text).length };
}

describe("hashText", () => {
  it("is stable for identical content", () => {
    expect(hashText("export const a = 1;")).toBe(hashText("export const a = 1;"));
  });

  it("changes when the content changes", () => {
    expect(hashText("a")).not.toBe(hashText("b"));
  });

  it("ignores the difference between CRLF and LF", () => {
    /*
     * Not cosmetic. This checkout has `core.autocrlf=true`, so the same commit produces
     * different bytes on Windows and Linux. Without normalising, every file would look
     * changed after a fresh clone on the other platform and the whole repo would re-embed.
     */
    const lf = `line one${NL}line two${NL}`;
    const crlf = lf.split(NL).join(String.fromCharCode(13, 10));
    expect(hashText(crlf)).toBe(hashText(lf));
  });

  it("does not collide on a trailing-newline difference in content that matters", () => {
    expect(hashText(`a${NL}b`)).not.toBe(hashText(`a${NL}b${NL}c`));
  });
});

describe("planBuild", () => {
  const A = `export const a = 1;${NL}`;
  const B = `export const b = 2;${NL}`;

  it("treats everything as changed when there is no previous index", () => {
    const plan = planBuild(scanned({ "a.ts": A, "b.ts": B }), null, 0);

    expect(plan.changed).toEqual(["a.ts", "b.ts"]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.chunksToEmbed).toBeGreaterThan(0);
    expect(plan.chunksReused).toBe(0);
  });

  it("finds nothing to do when nothing changed", () => {
    // The property the whole layer exists for: a rebuild after no edits embeds nothing.
    const files = scanned({ "a.ts": A, "b.ts": B });
    const previous = manifest({ "a.ts": recordFor("a.ts", A), "b.ts": recordFor("b.ts", B) });

    const plan = planBuild(files, previous, 0);
    expect(plan.changed).toEqual([]);
    expect(plan.chunksToEmbed).toBe(0);
    expect(plan.unchanged).toEqual(["a.ts", "b.ts"]);
    expect(plan.chunksReused).toBe(2);
  });

  it("re-embeds only the file that changed", () => {
    const previous = manifest({ "a.ts": recordFor("a.ts", A), "b.ts": recordFor("b.ts", B) });
    const plan = planBuild(scanned({ "a.ts": A, "b.ts": `${B}// edited${NL}` }), previous, 0);

    expect(plan.changed).toEqual(["b.ts"]);
    expect(plan.unchanged).toEqual(["a.ts"]);
    expect(plan.chunksReused).toBe(1);
  });

  it("notices an edit that git has not been told about", () => {
    /*
     * Per-file hashing rather than trusting the git SHA. Uncommitted edits are exactly the
     * state a developer is in when they ask a question about their own code — an index that
     * only noticed committed work would answer about the wrong version of the file while
     * reporting itself perfectly fresh.
     */
    const previous = manifest({ "a.ts": recordFor("a.ts", A) });
    const plan = planBuild(scanned({ "a.ts": `${A}// uncommitted${NL}` }), previous, 0);
    expect(plan.changed).toEqual(["a.ts"]);
  });

  it("reports a file that has been deleted", () => {
    const previous = manifest({ "a.ts": recordFor("a.ts", A), "gone.ts": recordFor("gone.ts", B) });
    const plan = planBuild(scanned({ "a.ts": A }), previous, 0);

    expect(plan.removed).toEqual(["gone.ts"]);
    expect(plan.changed).toEqual([]);
  });

  it("reports a new file as changed and not as removed", () => {
    const previous = manifest({ "a.ts": recordFor("a.ts", A) });
    const plan = planBuild(scanned({ "a.ts": A, "new.ts": B }), previous, 0);

    expect(plan.changed).toEqual(["new.ts"]);
    expect(plan.removed).toEqual([]);
  });

  it("counts a rename as one removal and one addition", () => {
    // Content-addressed hashing cannot see a rename, and does not need to: the cost is one
    // file's worth of embedding, which is what a rename actually costs to re-index.
    const previous = manifest({ "old.ts": recordFor("old.ts", A) });
    const plan = planBuild(scanned({ "new.ts": A }), previous, 0);

    expect(plan.changed).toEqual(["new.ts"]);
    expect(plan.removed).toEqual(["old.ts"]);
  });

  it("returns sorted lists, so a plan is comparable between runs", () => {
    // The preview and the build must agree, and a test must not depend on walk order.
    const plan = planBuild(scanned({ "z.ts": A, "a.ts": A, "m.ts": A }), null, 0);
    expect(plan.changed).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  it("carries the skipped count through untouched", () => {
    expect(planBuild(scanned({ "a.ts": A }), null, 17).skipped).toBe(17);
  });

  it("counts chunks to embed from the real chunker, not an estimate", () => {
    // The number that decides how long a build takes has to come from the thing that
    // actually produces the work.
    const long = Array.from({ length: 300 }, (_, i) => `const v${i} = ${i};`).join(NL);
    const plan = planBuild(scanned({ "big.ts": long }), null, 0);
    expect(plan.chunksToEmbed).toBe(chunkFile("big.ts", long).length);
  });

  it("reuses the recorded chunk count rather than re-chunking an unchanged file", () => {
    /*
     * The saving is not only in embedding. An unchanged file is never even chunked again —
     * the previous manifest already recorded how many chunks it produced, so planning a
     * rebuild over a large repo does no per-line work for the parts that did not move.
     */
    const previous = manifest({ "a.ts": { hash: hashText(A), chunks: 99 } });
    const plan = planBuild(scanned({ "a.ts": A }), previous, 0);
    expect(plan.chunksReused).toBe(99);
  });

  it("handles an empty repo", () => {
    const plan = planBuild(scanned({}), null, 0);
    expect(plan).toMatchObject({ changed: [], unchanged: [], removed: [], chunksToEmbed: 0 });
  });

  it("handles every file having been deleted", () => {
    const previous = manifest({ "a.ts": recordFor("a.ts", A) });
    const plan = planBuild(scanned({}), previous, 0);
    expect(plan.removed).toEqual(["a.ts"]);
    expect(plan.changed).toEqual([]);
  });
});

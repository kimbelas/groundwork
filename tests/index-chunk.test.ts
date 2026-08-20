import { describe, expect, it } from "vitest";

import {
  chunkFile,
  DEFAULT_MAX_LINES,
  isIndexable,
  looksBinaryOrGenerated,
  MAX_LINE_CHARS,
} from "@/lib/index/chunk";

/**
 * Chunking source into retrievable pieces.
 *
 * The load-bearing property is not chunk size — it is that every chunk knows the lines it
 * came from. P3's grounding rule is that a claim about the code must quote a real file and
 * line, checked by plain string match with no model involved. A chunk without an accurate
 * position makes that check impossible to pass honestly and easy to pass dishonestly.
 */

const NL = String.fromCharCode(10);
const lines = (n: number, prefix = "line") =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join(NL);

describe("chunkFile", () => {
  it("returns one chunk for a short file, covering every line", () => {
    const chunks = chunkFile("src/a.ts", lines(10));
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[0]?.endLine).toBe(10);
  });

  it("gives every chunk a line range that matches its text", () => {
    // The property that makes a citation verifiable: the text really is those lines.
    const source = lines(200);
    const all = source.split(NL);

    for (const chunk of chunkFile("src/a.ts", source)) {
      const expected = all.slice(chunk.startLine - 1, chunk.endLine).join(NL);
      expect(chunk.text).toBe(expected);
    }
  });

  it("uses 1-based inclusive lines, the way an editor does", () => {
    const chunks = chunkFile("src/a.ts", `first${NL}second${NL}third`);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[0]?.text.startsWith("first")).toBe(true);
  });

  it("builds an id from the file and the range", () => {
    const chunks = chunkFile("src/a.ts", lines(5));
    expect(chunks[0]?.id).toBe("src/a.ts:1-5");
  });

  it("covers the whole file across chunks, with no gap", () => {
    const chunks = chunkFile("src/a.ts", lines(500));
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks.at(-1)?.endLine).toBe(500);

    // Consecutive chunks either abut or overlap. A gap would make some lines unfindable.
    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1];
      const cur = chunks[i];
      expect(cur!.startLine).toBeLessThanOrEqual(prev!.endLine + 1);
    }
  });

  it("overlaps consecutive chunks, so a split definition is findable from either side", () => {
    const chunks = chunkFile("src/a.ts", lines(300));
    expect(chunks.length).toBeGreaterThan(1);
    // At least one boundary genuinely repeats lines rather than merely abutting.
    const overlapping = chunks.some(
      (c, i) => i > 0 && c.startLine <= (chunks[i - 1]?.endLine ?? 0),
    );
    expect(overlapping).toBe(true);
  });

  it("always advances, even when a boundary sits at the very start of the window", () => {
    /*
     * The termination guarantee. A file where every line looks like a declaration is the
     * adversarial case for "break at a boundary": if the chosen break can equal the window
     * start, the next window begins where this one did and the loop never ends.
     */
    const declarations = Array.from({ length: 400 }, (_, i) => `export const v${i} = ${i};`).join(
      NL,
    );
    const chunks = chunkFile("src/a.ts", declarations);

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.startLine).toBeGreaterThan(chunks[i - 1]!.startLine);
    }
  });

  it("prefers to start a chunk at a declaration", () => {
    // Not a parser and not trying to be one; a regex that usually lands on a declaration
    // is most of the retrieval benefit at none of the maintenance cost.
    const body = [
      ...Array.from({ length: DEFAULT_MAX_LINES - 2 }, (_, i) => `  doSomething(${i});`),
      "",
      "export function second() {",
      ...Array.from({ length: 40 }, (_, i) => `  more(${i});`),
      "}",
    ].join(NL);

    const chunks = chunkFile("src/a.ts", `export function first() {${NL}${body}`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]?.text.trimStart().startsWith("export function second")).toBe(true);
  });

  it("produces identical chunks for CRLF and LF versions of one file", () => {
    // Otherwise every rebuild on the other platform reads as a total change and re-embeds
    // the entire repository.
    const lf = `export const a = 1;${NL}export const b = 2;${NL}`;
    const crlf = lf.split(NL).join(String.fromCharCode(13, 10));
    expect(chunkFile("src/a.ts", crlf)).toEqual(chunkFile("src/a.ts", lf));
  });

  it("yields nothing for an empty or blank file", () => {
    // An empty chunk embeds to a vector that matches every query weakly, which is worse
    // than being absent — it is a confident-looking wrong answer.
    expect(chunkFile("src/a.ts", "")).toEqual([]);
    expect(chunkFile("src/a.ts", `${NL}${NL}   ${NL}`)).toEqual([]);
  });

  it("skips a blank run without emitting a chunk for it", () => {
    const source = `export const a = 1;${NL}${"".padEnd(0)}${NL.repeat(100)}export const b = 2;`;
    for (const chunk of chunkFile("src/a.ts", source)) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("respects a smaller maxLines", () => {
    const chunks = chunkFile("src/a.ts", lines(100), { maxLines: 10, overlapLines: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(10);
    for (const c of chunks) expect(c.endLine - c.startLine + 1).toBeLessThanOrEqual(10);
  });

  it("clamps an overlap that would exceed the window", () => {
    // An overlap >= maxLines would mean each window starts inside the previous one's start.
    const chunks = chunkFile("src/a.ts", lines(200), { maxLines: 10, overlapLines: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.startLine).toBeGreaterThan(chunks[i - 1]!.startLine);
    }
  });

  it("is deterministic, so a rebuild does not churn the index", () => {
    const source = lines(250);
    expect(chunkFile("src/a.ts", source)).toEqual(chunkFile("src/a.ts", source));
  });
});

describe("isIndexable", () => {
  it("accepts source and config", () => {
    for (const f of ["src/a.ts", "app/page.tsx", "main.py", "lib.rs", "README.md", "a/b.yml"]) {
      expect(isIndexable(f), f).toBe(true);
    }
  });

  it("accepts an extensionless name that is really config", () => {
    expect(isIndexable("Dockerfile")).toBe(true);
    expect(isIndexable("deploy/Dockerfile")).toBe(true);
  });

  it("rejects binaries and assets", () => {
    for (const f of ["logo.png", "font.woff2", "data.zip", "clip.mp4", "a.pdf"]) {
      expect(isIndexable(f), f).toBe(false);
    }
  });

  it("rejects generated files that share a source extension", () => {
    /*
     * These are the ones that matter. A minified bundle and a lockfile both end in an
     * extension the allowlist accepts, and both are enormous — indexing them does not
     * crash anything, it quietly fills the index with noise that makes every real result
     * rank lower.
     */
    for (const f of ["app.min.js", "styles.min.css", "types.d.ts", "pnpm-lock.yaml"]) {
      expect(isIndexable(f), f).toBe(false);
    }
    expect(isIndexable("package-lock.json")).toBe(false);
    expect(isIndexable("bundle.js.map")).toBe(false);
  });

  it("does not treat a dotfile's name as an extension", () => {
    // `.gitignore` has no extension; reading `.gitignore` as one would match nothing and
    // reading it as an allowlisted name is the intent.
    expect(isIndexable(".gitignore")).toBe(true);
    expect(isIndexable(".mysteryfile")).toBe(false);
  });

  it("is case-insensitive about extensions", () => {
    expect(isIndexable("A.TS")).toBe(true);
    expect(isIndexable("README.MD")).toBe(true);
  });
});

describe("looksBinaryOrGenerated", () => {
  it("catches a NUL byte", () => {
    expect(looksBinaryOrGenerated(`abc${String.fromCharCode(0)}def`)).toBe(true);
  });

  it("catches a very long line", () => {
    // Minified output that slipped past the name check. One line, megabytes of tokens.
    expect(looksBinaryOrGenerated("x".repeat(MAX_LINE_CHARS + 1))).toBe(true);
  });

  it("accepts ordinary source", () => {
    expect(looksBinaryOrGenerated(`export const a = 1;${NL}// a comment${NL}`)).toBe(false);
  });

  it("accepts a line exactly at the limit", () => {
    expect(looksBinaryOrGenerated("x".repeat(MAX_LINE_CHARS))).toBe(false);
  });
});

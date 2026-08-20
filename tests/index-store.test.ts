import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CodeChunk } from "@/lib/index/chunk";
import { DIMS, MODEL } from "@/lib/index/embeddings";
import {
  INDEX_VERSION,
  deleteIndex,
  indexPaths,
  readIndex,
  summarizeIndex,
  writeIndex,
  type Manifest,
  type StoredIndex,
} from "@/lib/index/store";

/**
 * The index on disk.
 *
 * Every claim here reduces to one rule: **the index is a cache, so the correct response to
 * anything wrong with it is to rebuild, never to throw.** A page renders this. A throw takes
 * down the screen; returning null rebuilds and nobody notices.
 */

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-index-"));
  process.env.GROUNDWORK_INDEX = dir;
});

afterEach(async () => {
  delete process.env.GROUNDWORK_INDEX;
  await fsp.rm(dir, { recursive: true, force: true });
});

function chunk(file: string, n: number): CodeChunk {
  return {
    id: `${file}:${n}-${n + 9}`,
    file,
    startLine: n,
    endLine: n + 9,
    text: `line ${n}`,
  };
}

function manifestFor(chunks: CodeChunk[], over: Partial<Manifest> = {}): Manifest {
  return {
    version: INDEX_VERSION,
    repo: "C:/work/repo",
    gitSha: "abc123",
    model: MODEL,
    dims: DIMS,
    keywordOnly: false,
    builtAt: "2026-08-20T09:00:00.000Z",
    files: { "src/a.ts": { hash: "h1", chunks: chunks.length } },
    chunkCount: chunks.length,
    ...over,
  };
}

/**
 * Vectors that look like real embeddings.
 *
 * Filled with varied decimals rather than mostly zeros, because a sparse fixture makes the
 * size comparison below meaningless: `[0,0,0,...]` is two characters per float as JSON,
 * while an actual embedding is around nineteen. Testing a compression claim against
 * unrealistic data proves nothing.
 */
function vectorsFor(count: number, seed = 1): Float32Array {
  const v = new Float32Array(count * DIMS);
  for (let i = 0; i < v.length; i += 1) {
    v[i] = Math.sin((i + 1) * 0.7311 * seed) * 0.0513;
  }
  return v;
}

function indexFor(count: number, over: Partial<Manifest> = {}): StoredIndex {
  const chunks = Array.from({ length: count }, (_, i) => chunk("src/a.ts", i * 10 + 1));
  return { manifest: manifestFor(chunks, over), chunks, vectors: vectorsFor(count) };
}

describe("write and read", () => {
  it("round-trips chunks and vectors", async () => {
    const written = indexFor(3);
    await writeIndex("alpha", written);

    const read = await readIndex("alpha");
    expect(read?.chunks).toEqual(written.chunks);
    expect(read?.vectors.length).toBe(3 * DIMS);
    expect(read?.manifest.chunkCount).toBe(3);
  });

  it("preserves float values exactly", async () => {
    // Written as raw little-endian Float32 rather than JSON. A rounding difference here
    // would silently change every similarity score.
    const written = indexFor(2);
    written.vectors[0] = 0.123456789;
    written.vectors[DIMS] = -0.987654321;
    await writeIndex("alpha", written);

    const read = await readIndex("alpha");
    expect(read?.vectors[0]).toBe(written.vectors[0]);
    expect(read?.vectors[DIMS]).toBe(written.vectors[DIMS]);
  });

  it("stores vectors far more compactly than JSON would", async () => {
    /*
     * The reason for the binary file. 384 floats per chunk is roughly 8 KB of decimal text
     * as JSON, so a 5,000-chunk repo writes about 40 MB and spends most of a rebuild in
     * JSON.parse. Raw Float32 is 1.5 KB per chunk.
     */
    const written = indexFor(20);
    await writeIndex("alpha", written);

    const onDisk = (await fsp.stat(indexPaths("alpha").vectors)).size;
    const asJson = JSON.stringify([...written.vectors]).length;

    expect(onDisk).toBe(20 * DIMS * 4);
    // Several times smaller, not marginally. The exact ratio depends on the values; the
    // claim being tested is the order of magnitude.
    expect(onDisk * 3).toBeLessThan(asJson);
  });

  it("returns null when nothing has been built", async () => {
    expect(await readIndex("never-built")).toBeNull();
  });

  it("keeps two projects separate", async () => {
    await writeIndex("alpha", indexFor(1));
    await writeIndex("beta", indexFor(5));

    expect((await readIndex("alpha"))?.chunks.length).toBe(1);
    expect((await readIndex("beta"))?.chunks.length).toBe(5);
  });

  it("rejects a slug that could escape the index root", async () => {
    // Same path validation as the vault layer; the index directory is derived from a slug.
    await expect(readIndex("../../etc")).rejects.toThrow();
  });

  it("overwrites a previous build rather than appending to it", async () => {
    await writeIndex("alpha", indexFor(5));
    await writeIndex("alpha", indexFor(2));
    expect((await readIndex("alpha"))?.chunks.length).toBe(2);
  });
});

describe("a damaged index rebuilds instead of throwing", () => {
  it("returns null for a manifest from an older layout", async () => {
    await writeIndex("alpha", indexFor(2, { version: INDEX_VERSION - 1 }));
    expect(await readIndex("alpha")).toBeNull();
  });

  it("returns null for a manifest that is not JSON", async () => {
    await writeIndex("alpha", indexFor(2));
    await fsp.writeFile(indexPaths("alpha").manifest, "{ not json", "utf8");
    expect(await readIndex("alpha")).toBeNull();
  });

  it("returns null when the chunk count disagrees with the manifest", async () => {
    /*
     * The cross-check that matters most. The vectors buffer is positional — row N belongs
     * to chunk N — so a count mismatch means every chunk would be ranked against the wrong
     * row. That is a confidently wrong answer, which is worse than no answer.
     */
    const written = indexFor(3);
    await writeIndex("alpha", written);
    await fsp.writeFile(
      indexPaths("alpha").chunks,
      JSON.stringify(written.chunks.slice(0, 2)),
      "utf8",
    );
    expect(await readIndex("alpha")).toBeNull();
  });

  it("returns null when the vectors file is the wrong length", async () => {
    const written = indexFor(3);
    await writeIndex("alpha", written);
    await fsp.writeFile(indexPaths("alpha").vectors, Buffer.alloc(DIMS * 4));
    expect(await readIndex("alpha")).toBeNull();
  });

  it("returns null when the vectors file is not a whole number of floats", async () => {
    const written = indexFor(1);
    await writeIndex("alpha", written);
    await fsp.writeFile(indexPaths("alpha").vectors, Buffer.alloc(DIMS * 4 - 1));
    expect(await readIndex("alpha")).toBeNull();
  });

  it("returns null when the chunks file is missing", async () => {
    await writeIndex("alpha", indexFor(2));
    await fsp.rm(indexPaths("alpha").chunks);
    expect(await readIndex("alpha")).toBeNull();
  });

  it("returns null when the model or dimensions changed", async () => {
    // Vectors from a different model are not comparable. Rebuilding is the only answer.
    await writeIndex("alpha", indexFor(2, { model: "some/other-model" }));
    expect(await readIndex("alpha")).toBeNull();
  });

  it("returns null when the chunks file is not an array", async () => {
    await writeIndex("alpha", indexFor(2));
    await fsp.writeFile(indexPaths("alpha").chunks, JSON.stringify({ nope: true }), "utf8");
    expect(await readIndex("alpha")).toBeNull();
  });
});

describe("a keyword-only index", () => {
  it("reads back with no vectors and does not look for the file", async () => {
    // Built on a machine where the model would not load. Search still works; it just says
    // so. Requiring a vectors file here would make the degraded path unreadable.
    const chunks = [chunk("src/a.ts", 1)];
    await writeIndex("alpha", {
      manifest: manifestFor(chunks, { keywordOnly: true }),
      chunks,
      vectors: new Float32Array(0),
    });

    const read = await readIndex("alpha");
    expect(read?.manifest.keywordOnly).toBe(true);
    expect(read?.vectors.length).toBe(0);
    expect(read?.chunks.length).toBe(1);
  });
});

describe("the manifest is the commit point", () => {
  it("a half-written build with no manifest reads as no index", async () => {
    /*
     * The manifest is renamed last on purpose. Chunks with no manifest read as "nothing
     * built", which rebuilds. A manifest promising chunks that are not there would instead
     * be an index that lies about itself.
     */
    await writeIndex("alpha", indexFor(2));
    await fsp.rm(indexPaths("alpha").manifest);
    expect(await readIndex("alpha")).toBeNull();
    expect((await summarizeIndex("alpha")).built).toBe(false);
  });

  it("leaves no temporary files behind", async () => {
    await writeIndex("alpha", indexFor(2));
    const entries = await fsp.readdir(indexPaths("alpha").dir);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });
});

describe("summarizeIndex", () => {
  it("reports nothing for a project with no index", async () => {
    const summary = await summarizeIndex("alpha");
    expect(summary.built).toBe(false);
    expect(summary.chunkCount).toBe(0);
    expect(summary.bytes).toBe(0);
  });

  it("reports counts and size without reading the chunks", async () => {
    await writeIndex("alpha", indexFor(4));
    const summary = await summarizeIndex("alpha");

    expect(summary.built).toBe(true);
    expect(summary.chunkCount).toBe(4);
    expect(summary.fileCount).toBe(1);
    expect(summary.gitSha).toBe("abc123");
    expect(summary.bytes).toBeGreaterThan(4 * DIMS * 4);
  });

  it("reports an old layout as not built, so it is rebuilt rather than shown", async () => {
    await writeIndex("alpha", indexFor(2, { version: INDEX_VERSION - 1 }));
    expect((await summarizeIndex("alpha")).built).toBe(false);
  });

  it("survives a missing vectors file, since the size is only cosmetic", async () => {
    await writeIndex("alpha", indexFor(2));
    await fsp.rm(indexPaths("alpha").vectors);

    const summary = await summarizeIndex("alpha");
    expect(summary.built).toBe(true);
    expect(summary.bytes).toBeGreaterThan(0);
  });
});

describe("deleteIndex", () => {
  it("removes the index and is safe to call twice", async () => {
    await writeIndex("alpha", indexFor(2));
    await deleteIndex("alpha");
    expect(await readIndex("alpha")).toBeNull();

    // Derived data: deleting it is always safe, and rebuilding is the fix.
    await deleteIndex("alpha");
    expect(await readIndex("alpha")).toBeNull();
  });

  it("does not touch another project", async () => {
    await writeIndex("alpha", indexFor(1));
    await writeIndex("beta", indexFor(1));
    await deleteIndex("alpha");
    expect(await readIndex("beta")).not.toBeNull();
  });
});

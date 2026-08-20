import fsp from "node:fs/promises";
import path from "node:path";

import { VaultError } from "@/lib/errors";
import { assertSlug } from "@/lib/paths";

import { DIMS, MODEL } from "./embeddings";
import type { CodeChunk } from "./chunk";

/**
 * Where a built index lives, and how it is written and read.
 *
 * ## Why this file may touch `fs`
 *
 * Same argument as `lib/runs.ts`, which owns `.groundwork/runs/`: this owns
 * `.groundwork/index/` and never resolves a path inside `vault/`. It is the only module
 * under `lib/index/` that touches disk — everything else there is pure and unit-tested
 * without a filesystem.
 *
 * ## The rule that keeps the vault trustworthy
 *
 * **Derived data never gets committed as prose.** `.groundwork/` is git-ignored: this
 * index is disposable and rebuildable from the repo, so it is never the source of truth
 * for anything. Delete it and the app rebuilds it. If that were ever untrue — if a plan
 * depended on something only the index knew — the vault would have stopped being the
 * database, which is the one architectural promise this project has.
 *
 * ## Why vectors are a binary file and not JSON
 *
 * 384 floats per chunk. As JSON that is roughly 8 KB of decimal text per chunk, so a
 * 5,000-chunk repo writes about 40 MB and spends most of a rebuild in `JSON.parse`. As
 * raw little-endian Float32 it is 1.5 KB per chunk — under 8 MB — and loads as one
 * `readFile`. The metadata stays JSON, because that part is read by people when something
 * looks wrong.
 */

/** Bump when the on-disk shape changes, so an old index is rebuilt rather than misread. */
export const INDEX_VERSION = 1;

export interface FileRecord {
  /** Content hash of the normalised text. Decides whether re-embedding is needed. */
  hash: string;
  chunks: number;
}

export interface Manifest {
  version: number;
  /** The repo this was built from, absolute and resolved. */
  repo: string;
  /** HEAD at build time, or null outside a git repo. A fast path, never the only check. */
  gitSha: string | null;
  model: string;
  dims: number;
  /** True when embeddings were unavailable and only keyword search will work. */
  keywordOnly: boolean;
  builtAt: string;
  files: Record<string, FileRecord>;
  chunkCount: number;
}

export interface StoredIndex {
  manifest: Manifest;
  chunks: CodeChunk[];
  /** `chunkCount × dims` little-endian floats, or empty when keyword-only. */
  vectors: Float32Array;
}

/**
 * Root for derived index data.
 *
 * `GROUNDWORK_INDEX` overrides it, which is what lets the test suite point somewhere
 * disposable instead of the developer's real `.groundwork/`.
 */
export function indexRoot(): string {
  const override = process.env.GROUNDWORK_INDEX;
  return override && override.trim().length > 0
    ? path.resolve(override)
    : path.resolve(process.cwd(), ".groundwork", "index");
}

/** One directory per project, because a project has at most one repo. */
export function indexPaths(slug: string): {
  dir: string;
  manifest: string;
  chunks: string;
  vectors: string;
} {
  assertSlug(slug);
  const dir = path.join(indexRoot(), slug);
  return {
    dir,
    manifest: path.join(dir, "manifest.json"),
    chunks: path.join(dir, "chunks.json"),
    vectors: path.join(dir, "vectors.bin"),
  };
}

/**
 * Write the index.
 *
 * Written to temporary names and renamed, for the same reason `lib/vault.ts` does it: a
 * reader that arrives mid-write must see the old index or the new one, never a truncated
 * manifest. The manifest is renamed **last**, so it is the commit point — a half-written
 * set of chunks with no manifest reads as "no index", which is recoverable, whereas a
 * manifest promising chunks that are not there is not.
 */
export async function writeIndex(slug: string, index: StoredIndex): Promise<void> {
  const p = indexPaths(slug);
  await fsp.mkdir(p.dir, { recursive: true });

  const tmp = (f: string) => `${f}.tmp`;

  await fsp.writeFile(tmp(p.chunks), JSON.stringify(index.chunks), "utf8");
  await fsp.writeFile(
    tmp(p.vectors),
    Buffer.from(index.vectors.buffer, index.vectors.byteOffset, index.vectors.byteLength),
  );
  await fsp.writeFile(tmp(p.manifest), JSON.stringify(index.manifest, null, 2), "utf8");

  await fsp.rename(tmp(p.chunks), p.chunks);
  await fsp.rename(tmp(p.vectors), p.vectors);
  await fsp.rename(tmp(p.manifest), p.manifest);
}

async function readIfPresent(file: string): Promise<Buffer | null> {
  try {
    return await fsp.readFile(file);
  } catch {
    return null;
  }
}

/**
 * Read the index, or null when there is not a usable one.
 *
 * Every inconsistency returns null rather than throwing. An index is a cache: the correct
 * response to a corrupt or half-written one is to rebuild, and a throw here would take
 * down whatever page asked. That is also why the counts are cross-checked — a vectors file
 * that does not match the manifest's chunk count would otherwise rank chunks against
 * whatever bytes happened to follow.
 */
export async function readIndex(slug: string): Promise<StoredIndex | null> {
  const p = indexPaths(slug);

  const rawManifest = await readIfPresent(p.manifest);
  if (!rawManifest) return null;

  let manifest: Manifest;
  try {
    manifest = JSON.parse(rawManifest.toString("utf8")) as Manifest;
  } catch {
    return null;
  }
  if (manifest.version !== INDEX_VERSION) return null;

  const rawChunks = await readIfPresent(p.chunks);
  if (!rawChunks) return null;

  let chunks: CodeChunk[];
  try {
    const parsed: unknown = JSON.parse(rawChunks.toString("utf8"));
    if (!Array.isArray(parsed)) return null;
    chunks = parsed as CodeChunk[];
  } catch {
    return null;
  }
  if (chunks.length !== manifest.chunkCount) return null;

  if (manifest.keywordOnly) return { manifest, chunks, vectors: new Float32Array(0) };

  const rawVectors = await readIfPresent(p.vectors);
  if (!rawVectors) return null;

  // A Float32Array view needs 4-byte alignment and a whole number of floats. `Buffer` is a
  // slice of a shared pool, so its byteOffset is not guaranteed aligned — copying is the
  // only correct read, and at these sizes it is one memcpy.
  if (rawVectors.byteLength % 4 !== 0) return null;
  const vectors = new Float32Array(rawVectors.byteLength / 4);
  Buffer.from(vectors.buffer).set(rawVectors);

  if (vectors.length !== chunks.length * manifest.dims) return null;
  if (manifest.dims !== DIMS || manifest.model !== MODEL) return null;

  return { manifest, chunks, vectors };
}

/** Throw the index away. Safe at any time: it is derived, and rebuilding is the fix. */
export async function deleteIndex(slug: string): Promise<void> {
  const p = indexPaths(slug);
  await fsp.rm(p.dir, { recursive: true, force: true });
}

export interface IndexSummary {
  built: boolean;
  chunkCount: number;
  fileCount: number;
  builtAt: string | null;
  gitSha: string | null;
  keywordOnly: boolean;
  /** Bytes on disk, so the user can see what the index costs them. */
  bytes: number;
}

/**
 * Cheap status for display. Reads the manifest only, never the chunks or vectors.
 *
 * The panel showing this renders on a `force-dynamic` page, so it must not pull megabytes
 * off disk to say "4,812 chunks".
 */
export async function summarizeIndex(slug: string): Promise<IndexSummary> {
  const empty: IndexSummary = {
    built: false,
    chunkCount: 0,
    fileCount: 0,
    builtAt: null,
    gitSha: null,
    keywordOnly: false,
    bytes: 0,
  };

  const p = indexPaths(slug);
  const raw = await readIfPresent(p.manifest);
  if (!raw) return empty;

  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8")) as Manifest;
  } catch {
    return empty;
  }
  if (manifest.version !== INDEX_VERSION) return empty;

  let bytes = raw.byteLength;
  for (const file of [p.chunks, p.vectors]) {
    try {
      bytes += (await fsp.stat(file)).size;
    } catch {
      // A missing part means the index is unusable; readIndex will return null and it
      // rebuilds. The size is cosmetic, so it is not worth failing over.
    }
  }

  return {
    built: true,
    chunkCount: manifest.chunkCount,
    fileCount: Object.keys(manifest.files ?? {}).length,
    builtAt: manifest.builtAt,
    gitSha: manifest.gitSha,
    keywordOnly: manifest.keywordOnly === true,
    bytes,
  };
}

/** Guard for a caller that has a slug but no index yet, when one is required. */
export function requireIndex(index: StoredIndex | null, slug: string): StoredIndex {
  if (!index) {
    throw new VaultError(
      "not_found",
      `No index has been built for ${slug} yet. Build it before searching the repository.`,
    );
  }
  return index;
}

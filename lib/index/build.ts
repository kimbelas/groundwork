import { createHash } from "node:crypto";

import { headSha } from "@/lib/git";
import { listRepoFiles, readRepoFile } from "@/lib/repo";

import { chunkFile, isIndexable, looksBinaryOrGenerated, type CodeChunk } from "./chunk";
import { DIMS, MODEL, embedBatch, embeddingsAvailable } from "./embeddings";
import {
  INDEX_VERSION,
  readIndex,
  writeIndex,
  type FileRecord,
  type Manifest,
  type StoredIndex,
} from "./store";

/**
 * Building the index, and doing it again cheaply.
 *
 * Embedding is the expensive step — it is the only part of this app that costs real time —
 * so the interesting work here is all about not doing it. A second build after one commit
 * re-embeds the files in that commit and nothing else.
 *
 * No `fs` in this module: files come from `lib/repo.ts` (read-only, contained) and
 * persistence goes through `lib/index/store.ts`. That separation is what lets the whole
 * incremental rule be tested without a repository on disk.
 */

/** Content hash of the normalised text, so CRLF and LF checkouts agree. */
export function hashText(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n?/g, "\n")).digest("hex").slice(0, 16);
}

export interface BuildPlan {
  /** Files that will be read, chunked and embedded. */
  changed: string[];
  /** Files whose chunks and vectors are reused as-is. */
  unchanged: string[];
  /** Files in the old index that are gone from the repo. */
  removed: string[];
  /** Chunks that will need embedding — the number that decides how long this takes. */
  chunksToEmbed: number;
  /** Chunks carried over without work. */
  chunksReused: number;
  /** Files skipped as not source: wrong extension, binary, generated, or too large. */
  skipped: number;
}

export interface CostPreview extends BuildPlan {
  /** Rough token count for the text to be embedded. */
  approxTokens: number;
  /** Seconds, from a measured local throughput. Wide on purpose. */
  estimatedSeconds: number;
  /** True when there is nothing to do. */
  upToDate: boolean;
  embeddingsReady: boolean;
  embeddingsReason?: string;
}

/**
 * Chunks per second, measured locally on q8 weights.
 *
 * A single number cannot be right on every machine, and that is fine — the estimate exists
 * so a user can tell "about a minute" from "leave this running", not to be a promise.
 * Under-promising is the safer direction, so this is the low end of what was observed.
 */
const CHUNKS_PER_SECOND = 12;

/** Characters per token, roughly, for source code. Used only for the preview. */
const CHARS_PER_TOKEN = 3.6;

interface Scanned {
  files: Map<string, { text: string; hash: string }>;
  skipped: number;
}

/**
 * Read every indexable file once.
 *
 * One pass, and the text is kept, because the alternative is reading each changed file
 * again during the build. A repo's source is a few megabytes; holding it briefly is
 * cheaper than a second pass over the disk.
 */
async function scan(repo: string): Promise<Scanned> {
  const { files: all } = await listRepoFiles(repo);
  const files = new Map<string, { text: string; hash: string }>();
  let skipped = 0;

  for (const rel of all) {
    if (!isIndexable(rel)) {
      skipped += 1;
      continue;
    }

    let text: string;
    try {
      text = await readRepoFile(repo, rel);
    } catch {
      // Over the size cap, vanished mid-scan, or unreadable. One file is not a build
      // failure — a repo is someone else's working directory and it changes underfoot.
      skipped += 1;
      continue;
    }

    if (looksBinaryOrGenerated(text)) {
      skipped += 1;
      continue;
    }

    files.set(rel, { text, hash: hashText(text) });
  }

  return { files, skipped };
}

/**
 * Work out what has changed, without doing any of it.
 *
 * Per-file hashing rather than trusting the git SHA alone. A SHA match is a strong hint
 * and a useless guarantee: uncommitted edits are exactly the state a developer is in when
 * they ask a question about their code, and an index that only noticed committed work
 * would answer about the wrong version of the file while looking perfectly fresh.
 */
export function planBuild(
  scanned: Map<string, { text: string; hash: string }>,
  previous: Manifest | null,
  skipped: number,
): BuildPlan {
  const changed: string[] = [];
  const unchanged: string[] = [];
  let chunksToEmbed = 0;
  let chunksReused = 0;

  for (const [rel, { text, hash }] of scanned) {
    const before = previous?.files[rel];
    if (before && before.hash === hash) {
      unchanged.push(rel);
      chunksReused += before.chunks;
      continue;
    }
    changed.push(rel);
    chunksToEmbed += chunkFile(rel, text).length;
  }

  const present = new Set(scanned.keys());
  const removed = Object.keys(previous?.files ?? {}).filter((f) => !present.has(f));

  // Sorted so two plans over the same repo compare equal, which is what makes the preview
  // and the build agree and keeps a test from depending on walk order.
  changed.sort();
  unchanged.sort();
  removed.sort();

  return { changed, unchanged, removed, chunksToEmbed, chunksReused, skipped };
}

/** What a build would cost, before committing to it. */
export async function previewBuild(slug: string, repo: string): Promise<CostPreview> {
  const { files, skipped } = await scan(repo);
  const existing = await readIndex(slug);
  const plan = planBuild(files, existing?.manifest ?? null, skipped);

  let chars = 0;
  for (const rel of plan.changed) {
    const entry = files.get(rel);
    if (entry) chars += entry.text.length;
  }

  const availability = await embeddingsAvailable();

  return {
    ...plan,
    approxTokens: Math.round(chars / CHARS_PER_TOKEN),
    estimatedSeconds: Math.ceil(plan.chunksToEmbed / CHUNKS_PER_SECOND),
    upToDate:
      plan.changed.length === 0 && plan.removed.length === 0 && existing !== null,
    embeddingsReady: availability.ready,
    ...(availability.reason ? { embeddingsReason: availability.reason } : {}),
  };
}

export interface BuildResult {
  plan: BuildPlan;
  chunkCount: number;
  keywordOnly: boolean;
  /** Set when embeddings were unavailable, so the caller can say why. */
  degradedReason?: string;
}

/**
 * Build or refresh the index.
 *
 * Reuses the vectors of unchanged files by copying them out of the old buffer rather than
 * re-embedding. That copy is the entire optimisation: without it, "incremental" would mean
 * re-reading cheaply and re-embedding everything, which is the part that takes minutes.
 */
export async function buildIndex(
  slug: string,
  repo: string,
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<BuildResult> {
  const { files, skipped } = await scan(repo);
  const existing = await readIndex(slug);
  const plan = planBuild(files, existing?.manifest ?? null, skipped);

  /*
   * Chunks are grouped by file and the files are sorted, so the index has a deterministic
   * layout. Two builds of the same tree produce byte-identical chunk metadata, which is
   * what makes "did the index change?" answerable and stops a rebuild from looking like a
   * total rewrite.
   */
  const ordered = [...files.keys()].sort();

  const reusableChunks = new Map<string, CodeChunk[]>();
  const reusableVectors = new Map<string, Float32Array>();

  if (existing) {
    const unchangedSet = new Set(plan.unchanged);
    const byFile = new Map<string, { chunk: CodeChunk; row: number }[]>();

    existing.chunks.forEach((chunk, row) => {
      if (!unchangedSet.has(chunk.file)) return;
      const list = byFile.get(chunk.file) ?? [];
      list.push({ chunk, row });
      byFile.set(chunk.file, list);
    });

    for (const [file, entries] of byFile) {
      reusableChunks.set(
        file,
        entries.map((e) => e.chunk),
      );

      if (existing.manifest.keywordOnly) continue;

      const vec = new Float32Array(entries.length * DIMS);
      entries.forEach((e, i) => {
        vec.set(existing.vectors.subarray(e.row * DIMS, (e.row + 1) * DIMS), i * DIMS);
      });
      reusableVectors.set(file, vec);
    }
  }

  const chunks: CodeChunk[] = [];
  const fileRecords: Record<string, FileRecord> = {};

  /** Where each file's chunks sit in the flat arrays, and whether they need work. */
  const spans: { file: string; from: number; count: number; reused: boolean }[] = [];

  for (const rel of ordered) {
    const entry = files.get(rel);
    if (!entry) continue;

    const reused = reusableChunks.get(rel);
    const fileChunks = reused ?? chunkFile(rel, entry.text);

    if (fileChunks.length === 0) {
      // A file with no indexable content still gets a record, so it is not re-read as
      // "changed" on every subsequent build.
      fileRecords[rel] = { hash: entry.hash, chunks: 0 };
      continue;
    }

    spans.push({ file: rel, from: chunks.length, count: fileChunks.length, reused: !!reused });
    chunks.push(...fileChunks);
    fileRecords[rel] = { hash: entry.hash, chunks: fileChunks.length };
  }

  const availability = await embeddingsAvailable();
  let vectors = new Float32Array(0);
  let keywordOnly = true;

  if (availability.ready && chunks.length > 0) {
    vectors = new Float32Array(chunks.length * DIMS);
    keywordOnly = false;

    let embeddedSoFar = 0;

    for (const span of spans) {
      if (span.reused) {
        const vec = reusableVectors.get(span.file);
        // A reused span with no vector means the previous index was keyword-only. Nothing
        // to copy, so it falls through to being embedded below.
        if (vec && vec.length === span.count * DIMS) {
          vectors.set(vec, span.from * DIMS);
          continue;
        }
      }

      const slice = chunks.slice(span.from, span.from + span.count);
      const embedded = await embedBatch(
        slice.map((c) => c.text),
        {
          onProgress: (batchDone) =>
            opts.onProgress?.(embeddedSoFar + batchDone, plan.chunksToEmbed),
        },
      );

      if (!embedded || embedded.length !== span.count * DIMS) {
        /*
         * The model became unavailable part-way through, or returned a short result.
         *
         * Fall back to a keyword-only index rather than keeping a buffer with zeroed rows.
         * A zero vector scores 0 against every query, which is not "missing" — it is a
         * confident claim that the chunk is unrelated to everything, and it would sit in
         * the index looking like a valid answer.
         */
        keywordOnly = true;
        vectors = new Float32Array(0);
        break;
      }

      vectors.set(embedded, span.from * DIMS);
      embeddedSoFar += span.count;
    }
  }

  const manifest: Manifest = {
    version: INDEX_VERSION,
    repo,
    gitSha: await headSha(repo),
    model: MODEL,
    dims: DIMS,
    keywordOnly,
    builtAt: new Date().toISOString(),
    files: fileRecords,
    chunkCount: chunks.length,
  };

  await writeIndex(slug, { manifest, chunks, vectors } satisfies StoredIndex);

  return {
    plan,
    chunkCount: chunks.length,
    keywordOnly,
    ...(keywordOnly && availability.reason ? { degradedReason: availability.reason } : {}),
  };
}

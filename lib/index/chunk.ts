/**
 * Splitting a source file into retrievable pieces.
 *
 * ## Why this is not the prose chunker it was ported from
 *
 * The version this started as split on sentence boundaries and packed ~45 words per
 * chunk, which is right for documents and wrong for code twice over.
 *
 * Code has no sentences. A regex looking for `.!?` finds property access, decimals and
 * every ternary, so it cuts mid-expression and produces fragments that mean nothing on
 * their own. And a chunk with no position cannot be cited: the whole point of indexing a
 * repo is that a planning card claiming "the indexer is serial" has to quote **the actual
 * line**, which means every chunk carries the line range it came from. Grounding checks
 * that quote by plain string match with no model involved, so the citation has to be
 * exact or the check is theatre.
 *
 * So: chunk by lines, keep the numbers, and prefer to break where a reader would.
 */

export interface CodeChunk {
  /** `src/index.ts:120-164` — stable, and readable in a diff. */
  id: string;
  /** Repo-relative path with forward slashes. */
  file: string;
  /** 1-based, inclusive. What a person and an editor both mean by "line 120". */
  startLine: number;
  endLine: number;
  text: string;
}

/** Lines per chunk before a break is forced. */
export const DEFAULT_MAX_LINES = 60;

/** Lines repeated from the previous chunk, so a definition split across a boundary is
 *  still findable from either side. */
export const DEFAULT_OVERLAP_LINES = 6;

/** Refuse to index a line longer than this; a minified bundle is not source. */
export const MAX_LINE_CHARS = 2000;

/**
 * Lines that make a good place to start a chunk.
 *
 * Not a parser, and deliberately not one. A real parser per language is a large
 * dependency and a large maintenance surface for a gain retrieval barely notices —
 * whereas *nearly* always starting at a declaration is most of the benefit for a regex.
 * The cost of being wrong is a chunk that begins slightly early, which retrieval
 * tolerates because of the overlap.
 */
const BOUNDARY =
  /^\s*(?:export\s|import\s|declare\s|public\s|private\s|protected\s|static\s|async\s|function\s|class\s|interface\s|type\s|enum\s|struct\s|impl\s|trait\s|fn\s|def\s|const\s|let\s|var\s|package\s|module\s|namespace\s|#\[|@|\/\*\*|##?#?\s)/;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

interface Cut {
  at: number;
  /**
   * True when the cut landed on a line that opens something.
   *
   * This decides whether the next chunk overlaps. Overlap exists so a definition sliced in
   * half is still findable from either side - and a cut exactly at a declaration slices
   * nothing, so repeating lines there would drag the next chunk back to the middle of the
   * previous definition and undo the alignment that was just found.
   */
  clean: boolean;
}

/**
 * Where to cut, given a window that has grown to its limit.
 *
 * Walks backwards from the hard limit for a line that opens something, then for a blank
 * line, then gives up and cuts at the limit. Backwards and bounded, so it always
 * terminates - an earlier draft searched FORWARD for a boundary, which on a file with one
 * very long line could run to the end and produce a single chunk for the whole thing.
 */
function findCut(lines: string[], from: number, to: number): Cut {
  for (let i = to; i > from + 1; i -= 1) {
    const line = lines[i];
    if (line !== undefined && BOUNDARY.test(line)) return { at: i, clean: true };
  }
  for (let i = to; i > from + 1; i -= 1) {
    const line = lines[i];
    if (line !== undefined && isBlank(line)) return { at: i, clean: false };
  }
  return { at: to, clean: false };
}

export interface ChunkOptions {
  maxLines?: number;
  overlapLines?: number;
}

/**
 * Split one file into chunks that each know where they came from.
 *
 * A file of only blank lines, or an empty file, yields nothing — an empty chunk would
 * embed to a meaningless vector that matches every query weakly, which is worse than
 * being absent.
 */
export function chunkFile(file: string, text: string, opts: ChunkOptions = {}): CodeChunk[] {
  const maxLines = Math.max(1, opts.maxLines ?? DEFAULT_MAX_LINES);
  const overlap = Math.max(0, Math.min(opts.overlapLines ?? DEFAULT_OVERLAP_LINES, maxLines - 1));

  // Normalise line endings so a CRLF checkout and an LF one produce identical chunk ids
  // and identical text — otherwise every index rebuild on the other platform looks like
  // a total change.
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const chunks: CodeChunk[] = [];
  let start = 0;

  while (start < lines.length) {
    const hardEnd = Math.min(start + maxLines, lines.length);
    const atEof = hardEnd >= lines.length;
    const cut: Cut = atEof ? { at: lines.length, clean: true } : findCut(lines, start, hardEnd);
    const end = cut.at;

    const slice = lines.slice(start, end);
    const body = slice.join("\n");

    if (body.trim().length > 0) {
      chunks.push({
        id: `${file}:${start + 1}-${end}`,
        file,
        startLine: start + 1,
        endLine: end,
        text: body,
      });
    }

    if (end >= lines.length) break;

    // Step forward by at least one line no matter what the overlap says, or a cut found at
    // `start + 1` would put the next window back where this one began and the loop would
    // never terminate. A clean cut takes no overlap - see the note on `Cut.clean`.
    start = cut.clean ? end : Math.max(start + 1, end - overlap);
  }

  return chunks;
}

/**
 * Files worth indexing, by extension.
 *
 * An allowlist, not a denylist. A repo contains images, lockfiles, fixtures and
 * generated bundles, and the failure mode of guessing wrong is not a crash — it is an
 * index full of noise that quietly makes every retrieval worse. Being narrow and
 * obviously extensible beats being clever.
 */
export const INDEXABLE = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".sql",
  ".sh",
  ".ps1",
  ".css",
  ".scss",
  ".html",
  ".vue",
  ".svelte",
  ".md",
  ".mdx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
]);

/** Names that are configuration worth reading even with no extension. */
export const INDEXABLE_NAMES = new Set([
  "Dockerfile",
  "Makefile",
  "Procfile",
  ".gitignore",
  ".env.example",
]);

/** Generated files that match an indexable extension but are not source. */
const GENERATED = /(?:\.min\.(?:js|css)|\.d\.ts|-lock\.(?:json|ya?ml)|\.lock|\.map|\.snap)$/;

export function isIndexable(relPath: string): boolean {
  const name = relPath.split("/").pop() ?? relPath;
  if (GENERATED.test(name)) return false;
  if (INDEXABLE_NAMES.has(name)) return true;

  const dot = name.lastIndexOf(".");
  // A leading dot is the whole name (`.gitignore`), not an extension.
  if (dot <= 0) return false;
  return INDEXABLE.has(name.slice(dot).toLowerCase());
}

/**
 * True when a file's content is not worth indexing whatever its name says.
 *
 * A NUL byte means binary. A very long line means minified or generated. Both produce
 * chunks that cost tokens to embed and can never usefully be quoted.
 */
export function looksBinaryOrGenerated(text: string): boolean {
  if (text.includes("\0")) return true;
  for (const line of text.split("\n")) {
    if (line.length > MAX_LINE_CHARS) return true;
  }
  return false;
}

import type { CodeChunk } from "@/lib/index/chunk";
import { citation, type Hit } from "@/lib/index/retrieve";

/**
 * The excerpt file's format: how it is written, and how it is read back.
 *
 * Both halves live here on purpose. The writer (`lib/ai/context.ts`) and the verifier
 * (`lib/ai/grounding.ts`) have to agree on exactly one thing — **where an excerpt ends** —
 * and when they disagreed the consequence was not a crash, it was ten honest citations
 * reported as fabrications.
 *
 * What happened: the verifier found a citation's heading and then cut the excerpt at the
 * next `\n## `, which is a fine rule for a markdown document and a wrong one here. The
 * excerpt *body* is arbitrary file content, and the first real repository it met was a
 * README whose own text is full of `## ` headings. The verifier saw 453 characters of a
 * 6,288-character excerpt and marked everything past the first subheading invented.
 *
 * That is the exact failure the design warns about — too strict, so honest citations read
 * "ungrounded" until the reader learns to ignore the warning, which is worse than not
 * checking at all. So the boundary is now the fence the writer actually wrote, and the rule
 * is stated once.
 *
 * This module is pure: no filesystem, no vault, no index reads. That is what lets
 * `grounding.ts` share it without pulling a server-only dependency graph behind it.
 */

/** Excerpts written at most. Eight chunks of ~60 lines is already a lot of context. */
export const MAX_EXCERPTS = 8;

/**
 * Byte ceiling for the excerpt file.
 *
 * Measured, not guessed. It was 6 KB, and a real run against a real repository produced
 * **one** excerpt: the first hit was a 6.8 KB README that consumed the whole budget on its
 * own, and everything else was dropped — so the model was handed a project's README and no
 * source at all. Real 60-line chunks of TypeScript run 1.5–3 KB, so honouring
 * `MAX_EXCERPTS` needs room for eight of them.
 *
 * Still a small fraction of any model's context, which is the point: retrieval exists so
 * the model reads a little of the repository rather than all of it.
 */
export const MAX_EXCERPT_BYTES = 16 * 1024;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove the repository's own location from text that is about to be handed to a run.
 *
 * Chunk *paths* are repo-relative by construction, but chunk *text* is arbitrary source
 * and a repo can perfectly well contain its own absolute path — in a config file, a
 * committed log, a comment. Writing that into the excerpt file would hand over the one
 * thing the whole design withholds, and it would do it in the file the model is told to
 * read. Every spelling of the separators is redacted, case-insensitively, because Windows
 * treats `C:\Repo` and `c:/repo` as one directory and source files escape their backslashes.
 *
 * The redaction happens before anything is written, so the bytes the model sees and the
 * bytes the grounding check compares against are the same bytes. A quote spanning a
 * redaction fails verification, which is the correct outcome and vanishingly rare.
 */
export function redactRepoPath(text: string, repo: string): string {
  const segments = repo.split(/[\\/]+/).filter((seg) => seg.length > 0);
  if (segments.length === 0) return text;

  /*
   * One pattern for every way a separator can be written, rather than a list of spellings.
   *
   * A list of three — the path, all-forward, all-back — was what shipped, and a review found
   * it blind to the spelling that matters most on Windows: source files escape their
   * backslashes. `"C:\\work\\portal\\dist"` in a committed `.json`, `.ts` or `.ps1`
   * contains neither `C:\work\portal` nor `C:/work/portal` as a substring, so the repo's
   * location went into the file the model is told to read. `.json`, `.yaml` and `.toml` are
   * all indexable, and a committed Windows path is doubled by definition.
   *
   * Matching each separator as `[\\/]+` covers doubled, single and mixed in one rule, which
   * is a smaller thing to get wrong than an enumeration nobody can prove is complete.
   */
  const pattern = segments.map(escapeRegExp).join("[\\\\/]+");
  return text.replace(new RegExp(pattern, "gi"), "<repo>");
}

/**
 * A fence longer than any run of backticks inside the text it has to contain.
 *
 * This is what makes the format parseable at all: the closing fence is guaranteed not to
 * appear inside the body, so "where does this excerpt end" has one answer even when the
 * body is itself markdown full of code fences.
 */
export function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

const HEADER = [
  "# Repository excerpts",
  "",
  "Retrieved by Groundwork from the repository connected to this project. **These excerpts",
  "are the only part of that repository available in this run.** Its location on disk is",
  "deliberately withheld, and there is no way to read more of it from here.",
  "",
  "Cite code as `path:startLine-endLine` — the heading above each excerpt is exactly that —",
  "and quote only text that appears verbatim below. Quotes are checked against this file by",
  "plain string match, so an invented citation is worse than an honest null.",
  "",
].join("\n");

function via(hit: Hit): string {
  if (hit.via === "both") return "matched by meaning and by term";
  return hit.via === "semantic" ? "matched by meaning" : "matched by term";
}

/**
 * Compose the excerpt file, dropping what does not fit and saying so.
 *
 * Pure, and exported for the same reason the chunker's rules are: what the model is shown
 * is the whole substance of this feature, and it should be assertable without a filesystem
 * or an embedding model.
 */
export function composeExcerpts(hits: Hit[], repo: string): { text: string; used: number } {
  const sections: string[] = [];
  let bytes = Buffer.byteLength(HEADER, "utf8");
  let used = 0;

  for (const hit of hits) {
    if (used >= MAX_EXCERPTS) break;
    const body = redactRepoPath(hit.chunk.text, repo);
    const fence = fenceFor(body);
    const section = `## ${citation(hit.chunk)}\n\n_${via(hit)}_\n\n${fence}\n${body}\n${fence}\n\n`;
    const size = Buffer.byteLength(section, "utf8");

    /*
     * Skip what does not fit and keep going — do not stop.
     *
     * Stopping is how a real run ended up with a single excerpt: the top hit was a 6.8 KB
     * README, it blew the whole budget, and eight smaller chunks of actual source behind it
     * were never considered. One oversized hit must cost itself, not the rest.
     *
     * The first excerpt is taken regardless of size, because returning an empty file for a
     * search that succeeded would report "no code found" when the truth is "one chunk was
     * long".
     */
    if (used > 0 && bytes + size > MAX_EXCERPT_BYTES) continue;

    sections.push(section);
    bytes += size;
    used += 1;
  }

  const dropped = hits.length - used;
  const note =
    dropped > 0
      ? `_${dropped} further excerpt${dropped === 1 ? "" : "s"} matched but did not fit._\n`
      : "";

  return { text: `${HEADER}${sections.join("")}${note}`, used };
}

/**
 * Every excerpt in the file, read as a structure rather than searched for as a string.
 *
 * This is deliberately a single pass from the top, and that is the whole point. The previous
 * version looked for a citation's heading *anywhere* in the file and then scanned forward to
 * the next fence — which a review broke in both directions using nothing but ordinary
 * repository content:
 *
 *  - **A forged citation verified.** Any markdown file that writes `## src/secret.ts:1-40`
 *    above a fenced block — a design doc, a changelog, this project's own docs — becomes an
 *    excerpt heading as far as a string search is concerned. A model could then cite
 *    `src/secret.ts` and have the quote confirmed, for a file that was never retrieved. That
 *    is fabrication passing review looking verified, which this module exists to prevent, and
 *    repository bytes reach the model's context, so it is reachable on purpose as well as by
 *    accident.
 *  - **An honest citation shadowed.** If an earlier excerpt's body contained
 *    `## b.ts:1-10`, a real citation of `b.ts:1-10` was verified against *that* text instead
 *    of the real excerpt, and failed.
 *
 * Walking the file in order fixes both, because a body is consumed as a body: once the parser
 * enters a fenced block it reads to the matching fence, so no line inside a body is ever
 * examined as a heading. The fence is safe to trust as a boundary because `fenceFor` sizes it
 * longer than any run of backticks in the content it wraps.
 */
export function parseExcerpts(excerpts: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = excerpts.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^## (.+?)\s*$/.exec(lines[i] ?? "");
    if (!heading) continue;

    const cite = heading[1];
    if (!cite) continue;

    // Find this section's opening fence. Another heading first means a malformed section;
    // skip it rather than reading past into the next one.
    let fence: string | null = null;
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const line = lines[j] ?? "";
      const opening = /^(`{3,})\s*$/.exec(line);
      if (opening) {
        fence = opening[1] ?? null;
        break;
      }
      if (/^## /.test(line)) break;
    }
    if (!fence) continue;

    const body: string[] = [];
    let closed = false;
    for (j += 1; j < lines.length; j += 1) {
      if ((lines[j] ?? "").trimEnd() === fence) {
        closed = true;
        break;
      }
      body.push(lines[j] ?? "");
    }

    /*
     * An unterminated fence means a truncated file: record nothing, and resume scanning after
     * the heading rather than after the body, so a half-written last section cannot verify a
     * quote and cannot swallow the sections above it.
     */
    if (!closed) continue;

    // First occurrence wins. Chunk ids are unique, so a duplicate heading is malformed input,
    // and the earlier one is the one the reader would believe.
    if (!out.has(cite)) out.set(cite, body.join("\n"));

    // Resume after the closing fence: every line of that body has now been consumed as body.
    i = j;
  }

  return out;
}

/**
 * The body of one excerpt, or null when the file holds no excerpt under that citation.
 *
 * Null is the answer a verifier needs: a citation of something never shown is exactly what
 * the check exists to catch.
 */
export function excerptBodyFor(excerpts: string, cite: string): string | null {
  return parseExcerpts(excerpts).get(cite) ?? null;
}

export type { CodeChunk, Hit };

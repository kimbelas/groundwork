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
 * read. Both separator spellings are redacted, case-insensitively, because Windows treats
 * `C:\Repo` and `c:/repo` as one directory and `lib/repo.ts` normalises to forward slashes.
 *
 * The redaction happens before anything is written, so the bytes the model sees and the
 * bytes the grounding check compares against are the same bytes. A quote spanning a
 * redaction fails verification, which is the correct outcome and vanishingly rare.
 */
export function redactRepoPath(text: string, repo: string): string {
  const spellings = new Set([repo, repo.split("\\").join("/"), repo.split("/").join("\\")]);
  let out = text;
  for (const spelling of spellings) {
    if (spelling.length === 0) continue;
    out = out.replace(new RegExp(escapeRegExp(spelling), "gi"), "<repo>");
  }
  return out;
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
 * The body of one excerpt, found the way it was written.
 *
 * Returns null when the file holds no excerpt under that citation — which is the answer a
 * verifier needs, because a citation of something never shown is exactly what the check
 * exists to catch.
 *
 * The boundary is the fence, not the next heading. `## ` at the start of a line is ordinary
 * content in any markdown file in any repository, and treating it as a delimiter is what
 * made a README's own subheadings truncate the excerpt they were inside.
 */
export function excerptBodyFor(excerpts: string, cite: string): string | null {
  const lines = excerpts.split(/\r?\n/);
  const marker = `## ${cite}`;

  let i = lines.findIndex((l) => l.trimEnd() === marker);
  if (i === -1) return null;

  // Scan to this excerpt's opening fence. Hitting another excerpt's heading first means the
  // file is malformed; returning null beats returning the neighbour's body.
  let fence: string | null = null;
  for (i += 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const opening = /^(`{3,})\s*$/.exec(line);
    if (opening) {
      fence = opening[1] ?? null;
      i += 1;
      break;
    }
    if (line.startsWith("## ")) return null;
  }
  if (!fence) return null;

  const body: string[] = [];
  for (; i < lines.length; i += 1) {
    if ((lines[i] ?? "").trimEnd() === fence) return body.join("\n");
    body.push(lines[i] ?? "");
  }

  // An unterminated fence means a truncated file; treat it as nothing rather than as
  // everything, so a half-written excerpt cannot verify a quote.
  return null;
}

export type { CodeChunk, Hit };

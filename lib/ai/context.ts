import { parseChecklist } from "@/lib/checklist";
import { readIndex } from "@/lib/index/store";
import { citation, search, type Hit } from "@/lib/index/retrieve";
import { isInside, normalizeRepoPath } from "@/lib/repo";
import { writeExcerpts } from "@/lib/runs";
import { getCard, getProject } from "@/lib/vault";

import type { AiJob } from "./types";

/**
 * Repository excerpts for a run: the app reads the code, the run reads the excerpts.
 *
 * ## Why the excerpts exist at all
 *
 * A spawned run is never told where a connected repository is. That is not a preference:
 * a run's permissions are a denylist anchored at the app root and `Write` is granted
 * broadly, so a path outside that root is not merely unlisted — it is unprotected.
 * `lib/ai/scope.ts` carries the full argument and `assertInstructionScoped` enforces it on
 * every spawn.
 *
 * So the app retrieves in process, through the index, and leaves the relevant bytes in the
 * run's own directory. Three things fall out of that which a run left to grep the repo
 * itself would lose: retrieval goes through the index rather than a shell, the cost is
 * bounded by the caps below rather than by the model's curiosity, and — the load-bearing
 * one — every byte the model could cite is a byte *this process* wrote, which is the only
 * way a grounding check can verify a quote without asking a model to check a model.
 *
 * ## Why it can never fail a run
 *
 * Repo grounding is an improvement to a run, not a precondition for one. A missing index,
 * a repo that has moved, a model that will not load — each of those degrades planning to
 * what it was before P2 and must never turn into a failed run. Same shape as
 * `lib/git.ts`: it returns a reason and the caller carries on.
 *
 * What it must not do is degrade silently. A user who believes planning read their code
 * and it did not will blame the plan, so every non-`included` status carries prose the run
 * panel shows.
 */

/** Distinct queries sent to the index. More is not better; it is slower and more diffuse. */
export const MAX_QUERIES = 6;

/** Excerpts written at most. Eight chunks of ~60 lines is already a lot of context. */
export const MAX_EXCERPTS = 8;

/**
 * Byte ceiling for the excerpt file.
 *
 * The point of retrieval is that the model reads a little of the repo rather than a lot,
 * so this is the mechanism, not a safety valve. Whatever is dropped is stated in the file.
 */
export const MAX_EXCERPT_BYTES = 6 * 1024;

/** Hits requested per query before merging. */
const PER_QUERY = 4;

/** Longest query text sent to the index; beyond this a line is a paragraph, not a query. */
const MAX_QUERY_CHARS = 200;

export type RepoContextStatus =
  /** No repository is connected to this project. The ordinary case. */
  | "no-repo"
  /** A repository is connected but has never been indexed. */
  | "no-index"
  /** The index was built from a different repository than the one now connected. */
  | "stale-index"
  /** The index was searched and had nothing relevant to say. */
  | "no-hits"
  /** Excerpts were written into the run directory. */
  | "included"
  /** Something went wrong. The run continues without code context. */
  | "unavailable";

export interface RepoContextResult {
  status: RepoContextStatus;
  /** True only when an excerpt file was written. */
  included: boolean;
  /** How many excerpts that file holds. */
  excerpts: number;
  /** Whether semantic ranking took part in choosing them, as opposed to keyword alone. */
  semantic: boolean;
  /** Prose for the run panel. Absent only when excerpts were included undegraded. */
  reason?: string;
}

// ---------------------------------------------------------------- queries

function tidy(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/, "")
    .replace(/^>\s*/, "")
    .trim()
    .slice(0, MAX_QUERY_CHARS);
}

function collect(candidates: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    const q = tidy(raw);
    // Two characters cannot be a useful query, and an index full of one-letter matches
    // is worse than no excerpt at all.
    if (q.length < 3) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Queries derived from a brief.
 *
 * Headings first, then the first line under each heading, then everything else in document
 * order. The ordering matters more than it looks: a vague five-line brief — the case this
 * app is built for — has no headings at all, so the fallback is not an edge case, it is the
 * common path. Taking lines in document order rather than by length keeps the queries in
 * the user's own vocabulary and in the order they thought of things.
 */
export function briefQueries(title: string, brief: string, limit = MAX_QUERIES): string[] {
  const lines = brief.split(/\r?\n/);
  const headings: string[] = [];
  const firstUnder: string[] = [];
  const rest: string[] = [];

  let awaitingFirst = false;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (/^#{1,6}\s+/.test(line)) {
      headings.push(line);
      awaitingFirst = true;
      continue;
    }
    if (awaitingFirst) {
      firstUnder.push(line);
      awaitingFirst = false;
      continue;
    }
    rest.push(line);
  }

  return collect([title, ...headings, ...firstUnder, ...rest], limit);
}

/**
 * Queries derived from one card.
 *
 * Acceptance criteria before body prose, because a criterion names the behaviour that has
 * to exist — which is what the code either already does or does not — while the body is
 * often context the criteria restate.
 */
export function cardQueries(title: string, body: string, limit = MAX_QUERIES): string[] {
  const acceptance = parseChecklist(body).map((i) => i.text);
  const items = new Set(acceptance.map((t) => t.trim()));
  const prose = body
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .filter((l) => !items.has(tidy(l)));

  return collect([title, ...acceptance, ...prose], limit);
}

// ---------------------------------------------------------------- composition

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

/** A fence longer than any run of backticks inside the text it has to contain. */
function fenceFor(text: string): string {
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
    // Always take the first one. An excerpt larger than the whole budget is a chunk of
    // long lines, and returning an empty file would report "no code found" for a repo the
    // index searched successfully.
    if (used > 0 && bytes + size > MAX_EXCERPT_BYTES) break;
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

// ---------------------------------------------------------------- retrieval

/** Round-robin across queries, so one broad query cannot crowd out the rest. */
function merge(results: Hit[][]): Hit[] {
  const out: Hit[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...results.map((r) => r.length));
  for (let i = 0; i < depth; i += 1) {
    for (const hits of results) {
      const hit = hits[i];
      if (!hit || seen.has(hit.chunk.id)) continue;
      seen.add(hit.chunk.id);
      out.push(hit);
    }
  }
  return out;
}

/** Path equality that survives Windows' case-insensitivity. `isInside` both ways is it. */
function sameRepo(a: string, b: string): boolean {
  return isInside(a, b) && isInside(b, a);
}

function none(status: RepoContextStatus, reason: string): RepoContextResult {
  return { status, included: false, excerpts: 0, semantic: false, reason };
}

/**
 * Retrieve repository excerpts for a job and write them into its run directory.
 *
 * Returns what happened, for the run record and the panel that reads it. Never throws:
 * every failure is a status plus prose, because a run that would have succeeded without
 * code context must still succeed with it unavailable.
 */
export async function buildRepoContext(job: AiJob, runId: string): Promise<RepoContextResult> {
  try {
    const project = await getProject(job.slug);
    if (!project.meta.repo) {
      return none("no-repo", "No repository is connected, so planning read the brief only.");
    }

    let repo: string;
    try {
      repo = normalizeRepoPath(project.meta.repo);
    } catch {
      return none(
        "unavailable",
        "The repository path in this project's frontmatter is not a usable absolute path.",
      );
    }

    const index = await readIndex(job.slug);
    if (!index) {
      return none(
        "no-index",
        "The connected repository has not been indexed yet, so planning read the brief only. " +
          "Build the index from the Repository panel.",
      );
    }

    if (!sameRepo(index.manifest.repo, repo)) {
      return none(
        "stale-index",
        "The index was built from a different repository than the one now connected. " +
          "Rebuild it before planning against the code.",
      );
    }

    const queries =
      job.kind === "enhance-card"
        ? await (async () => {
            const card = await getCard(job.slug, job.cardId);
            return cardQueries(card.title, card.body);
          })()
        : briefQueries(project.meta.name, project.brief);

    if (queries.length === 0) {
      return none("no-hits", "There was nothing in this project to search the repository for.");
    }

    const results: Hit[][] = [];
    let semantic = false;
    let degraded: string | undefined;
    for (const query of queries) {
      const result = await search(index, query, { limit: PER_QUERY });
      results.push(result.hits);
      if (result.semantic) semantic = true;
      if (result.degradedReason && !degraded) degraded = result.degradedReason;
    }

    const hits = merge(results);
    if (hits.length === 0) {
      return none(
        "no-hits",
        "Nothing in the indexed repository matched this project, so planning read the brief only.",
      );
    }

    const { text, used } = composeExcerpts(hits, repo);
    await writeExcerpts(runId, text);

    return {
      status: "included",
      included: true,
      excerpts: used,
      semantic,
      // A user told nothing would assume semantic search ran. Keyword-only results are
      // good ones, but they are a different thing and the difference is theirs to know.
      ...(semantic ? {} : { reason: degraded ?? "Excerpts were chosen by keyword matching only." }),
    };
  } catch (e) {
    return none(
      "unavailable",
      `The repository could not be searched for this run: ${(e as Error).message}`,
    );
  }
}

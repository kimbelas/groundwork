import path from "node:path";

import { VaultError } from "@/lib/errors";

/**
 * The rule that keeps a connected repository out of reach of a spawned AI run.
 *
 * ## The hole this closes
 *
 * `.claude/run-settings.json` is the only thing scoping what a run may write, and it is a
 * **denylist whose globs are relative to the app root** — `Write(vault/**)`,
 * `Write(lib/**)`, and so on. `--allowedTools` grants `Write` broadly because the CLI does
 * not honour a path-scoped *allow* rule (verified on 2.1.235, and recorded in that file),
 * so everything the run must not touch has to be named explicitly.
 *
 * A connected repo sits **outside** the app root. No relative glob in that file can name
 * it, and a per-run generated denylist would depend on absolute-path deny rules working —
 * which has not been tested, and an untested guard that reads like protection is worse
 * than none. So the boundary is built at the other end: **the run is never told where the
 * repo is.**
 *
 * ## How the repo gets used regardless
 *
 * The app reads the repo itself, in process, through `lib/repo.ts` — read-only and
 * contained — and writes the relevant excerpts into the run's own directory. The run reads
 * that. This is not a workaround; it is the design the retrieval layer requires regardless: a
 * run left to grep a repo directly would bypass the index, make cost unpredictable, and
 * put bytes into the model's context that the grounding check never saw. Verifying a quote
 * means comparing it against bytes *this process* read.
 *
 * ## Why a runtime check and not a comment
 *
 * The failure mode is a single plausible edit — adding "read the repo at <path>" to a
 * prompt when repo-grounded planning lands. That one line would silently hand write access
 * to a user's source tree. The check below runs on every spawn, so the edit fails loudly
 * the first time it is made instead of shipping.
 *
 * ## Why `path.resolve` and not a pattern
 *
 * The first version of this file matched absolute paths with a regex, and a review found
 * four spellings it missed: `//server/share/x`, `\work\x`, `D:x`, and a path glued after a
 * colon. Each resolves squarely outside the app root. The forward-slash UNC miss was the
 * worst, because this codebase's own house style produces it — `lib/repo.ts` normalises
 * paths with `.split(path.sep).join("/")`, so a repo on a network share becomes exactly the
 * spelling the pattern did not catch.
 *
 * Hand-written path patterns lose that game. `path.resolve` **is** the parser the operating
 * system's rules are written in: drive-relative, rooted, UNC and traversal all come out as
 * one answer, and a new spelling is covered the day Node supports it rather than the day
 * someone remembers to add a branch.
 */

/** Whitespace and the quoting characters a prompt puts around a path. */
const TOKEN_SPLIT = /[\s"'`]+/;

/** Trailing sentence punctuation, which is not part of the path. */
const TRAILING = /[.,;:)\]}]+$/;

/**
 * A web URL. Skipped whole, because splitting one at its colon leaves `//host/path`, which
 * resolves to a UNC share and would refuse every prompt that cites a document.
 *
 * Deliberately only http and https. Any other scheme — `file:` above all — keeps being
 * checked, because it does name a location on disk.
 */
const WEB_URL = /^https?:\/\//i;

/**
 * Every substring of `token` that could be read as a path.
 *
 * The token itself, plus whatever follows each colon that is not a drive letter's. That
 * second part is what catches a path interpolated straight after a label: `at:${repo}`
 * produces `at:C:\work\repo`, where the token as a whole looks relative and harmless while
 * its tail does not.
 */
export function pathCandidates(token: string): string[] {
  const trimmed = token.replace(TRAILING, "");
  if (trimmed.length === 0) return [];
  if (WEB_URL.test(trimmed)) return [];

  const out = [trimmed];
  for (let i = 0; i < trimmed.length; i += 1) {
    // Index 1 is a drive letter's colon: `C:\x` is one path, not a label plus a path.
    if (trimmed[i] === ":" && i !== 1) {
      const tail = trimmed.slice(i + 1);
      if (tail.length > 0) out.push(tail);
    }
  }
  return out;
}

/** True when `target` is `root` or sits inside it. Both must already be resolved. */
function contains(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export interface ScopeOptions {
  /**
   * Locations the run is legitimately told about even though they sit outside the app
   * root. In practice exactly one: the file it must write its proposal to, when
   * `GROUNDWORK_RUNS` points somewhere other than the checkout.
   */
  allow?: string[];
}

/**
 * Every path named in `text` that resolves outside `appRoot` and outside `allow`.
 *
 * Returned rather than thrown so a caller — and a test — can see all of them at once.
 */
export function findOutsidePaths(
  text: string,
  appRoot: string,
  opts: ScopeOptions = {},
): string[] {
  const root = path.resolve(appRoot);
  const allowed = (opts.allow ?? []).map((p) => path.resolve(p));

  const found: string[] = [];
  for (const token of text.split(TOKEN_SPLIT)) {
    for (const candidate of pathCandidates(token)) {
      const resolved = path.resolve(root, candidate);
      if (contains(root, resolved)) continue;
      if (allowed.some((a) => contains(a, resolved))) continue;
      found.push(candidate);
    }
  }
  return found;
}

/**
 * Refuse to spawn a run whose instruction names a location outside the app root.
 *
 * Absolute paths are not banned outright. `lib/ai/claude-cli.ts` hands the run an absolute
 * output path when the run directory sits outside the working directory, and that case is
 * legitimate — it is passed through `allow`. An earlier version had no such parameter, so
 * it rejected the very case its own comment called legitimate, so an install with
 * `GROUNDWORK_RUNS` set outside the checkout could not start a run at all.
 */
export function assertInstructionScoped(
  instruction: string,
  appRoot: string,
  opts: ScopeOptions = {},
): void {
  const outside = findOutsidePaths(instruction, appRoot, opts);
  if (outside.length === 0) return;

  throw new VaultError(
    "escapes_root",
    `Refusing to start an AI run: its instruction names ${outside[0]}, which is outside ` +
      `the app root. Permissions for a run are a denylist anchored at that root, so ` +
      `nothing outside it is protected — a run told about a path there could write to it. ` +
      `Read the file in-process with lib/repo.ts and put the excerpt in the run directory ` +
      `instead.`,
  );
}

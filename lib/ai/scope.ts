import path from "node:path";

import { VaultError } from "@/lib/errors";

/**
 * The rule that keeps a connected repository out of reach of a spawned AI run.
 *
 * ## The hole this closes
 *
 * `.claude/run-settings.json` is the only thing scoping what a run may write, and it is a
 * **denylist whose globs are relative to the app root** — `Write(vault/**)`,
 * `Write(lib/**)`, and so on. `--allowedTools` grants `Write` broadly because the CLI
 * does not honour a path-scoped *allow* rule (verified on 2.1.235, and recorded in that
 * file), so everything the run must not touch has to be named explicitly.
 *
 * A connected repo sits **outside** the app root. No relative glob in that file can name
 * it, and a per-run generated denylist would depend on absolute-path deny rules working —
 * which has not been tested, and an untested guard that reads like protection is worse
 * than none. So the boundary is built at the other end: **the run is never told where the
 * repo is.**
 *
 * ## How the repo gets used anyway
 *
 * The app reads the repo itself, in process, through `lib/repo.ts` — read-only and
 * contained — and writes the relevant excerpts into the run's own directory. The run
 * reads that. This is not a workaround; it is the design the retrieval layer requires
 * regardless: a run left to grep a repo directly would bypass the index, make cost
 * unpredictable, and put bytes into the model's context that the grounding check never
 * saw. Verifying a quote means comparing it against bytes *this process* read.
 *
 * ## Why a runtime check and not a comment
 *
 * The failure mode is a single plausible edit — adding "read the repo at <path>" to a
 * prompt when repo-grounded planning lands. That one line would silently hand write
 * access to a user's source tree. The check below runs on every spawn, so the edit fails
 * loudly the first time it is made instead of shipping.
 */

/**
 * Path-shaped tokens: a Windows drive path, a UNC share, or a POSIX absolute path.
 *
 * Deliberately greedy about what counts as a candidate. A false positive here is a
 * developer rewording a prompt; a false negative is a user's repo left writable.
 *
 * Both lookbehinds are load-bearing. A drive letter is exactly one character, and
 * without the first one the pattern read the `s:/` inside `https://` as a drive path
 * and refused any prompt mentioning a URL. The second keeps a URL's own slashes, and
 * an ordinary relative `a/b`, from matching the POSIX branch.
 */
const ABSOLUTE_CANDIDATE =
  /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\s"']+\\|(?<![\w:/])\/(?=[\w.]))[^\s"'`,;)]*/g;

export function findAbsolutePaths(text: string): string[] {
  return [...text.matchAll(ABSOLUTE_CANDIDATE)].map((m) => m[0]);
}

/**
 * Refuse to spawn a run whose instruction names a location outside the app root.
 *
 * Absolute paths are not banned outright: `lib/ai/claude-cli.ts` falls back to an
 * absolute output path when the run directory somehow sits outside the working directory,
 * and that case is legitimate. The rule is narrower and is the one that matters — every
 * path the run is told about must be somewhere the denylist can reach.
 */
export function assertInstructionScoped(instruction: string, appRoot: string): void {
  const root = path.resolve(appRoot);

  for (const candidate of findAbsolutePaths(instruction)) {
    const resolved = path.resolve(candidate);
    const rel = path.relative(root, resolved);
    const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));

    if (!inside) {
      throw new VaultError(
        "escapes_root",
        `Refusing to start an AI run: its instruction names ${candidate}, which is ` +
          `outside the app root. Permissions for a run are a denylist anchored at that ` +
          `root, so nothing outside it is protected — a run told about a path there ` +
          `could write to it. Read the file in-process with lib/repo.ts and put the ` +
          `excerpt in the run directory instead.`,
      );
    }
  }
}

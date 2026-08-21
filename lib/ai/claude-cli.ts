import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { appendStdout, hasExcerpts, runPaths } from "@/lib/runs";
import { VaultError } from "@/lib/errors";
import { vaultRoot } from "@/lib/vault";

import { assertInstructionScoped } from "./scope";
import type { AiEngine } from "./engine";
import type { AiEvent, AiJob } from "./types";

/**
 * Drives the Claude Code CLI already installed on this machine.
 *
 * Chosen over the API for v1 because it needs no key and no per-token spend, and because
 * it can read the vault with its own tools.
 */
const IS_WINDOWS = process.platform === "win32";

/**
 * Where the CLI lives, without naming anyone's home directory.
 *
 * This was a literal `C:\Users\<name>\AppData\Roaming\npm\claude.cmd`, which worked on
 * exactly one machine. `APPDATA` gives the same location for any Windows user, and npm's
 * global bin is where `npm i -g` puts the shim.
 *
 * Deriving beats resolving from `PATH`: npm's global directory is frequently absent from
 * the environment a dev server inherits — verified on this machine, where `cmd /c
 * claude.cmd` cannot find it but the derived absolute path runs fine. A bare name would
 * have looked tidier and broken the AI layer silently.
 *
 * `GROUNDWORK_CLAUDE_CMD` overrides all of it, which is the escape hatch for a CLI
 * installed somewhere else entirely.
 */
function defaultClaudeCmd(): string {
  if (!IS_WINDOWS) return "claude";
  const appData = process.env.APPDATA;
  return appData ? path.join(appData, "npm", "claude.cmd") : "claude.cmd";
}

const CLAUDE_CMD = process.env.GROUNDWORK_CLAUDE_CMD ?? defaultClaudeCmd();

/**
 * Permissions for the spawned run.
 *
 * In `-p` mode there is no human to approve a tool call, and the default mode prompts —
 * which in a headless process means the run blocks at its first Write and never produces
 * a proposal. So a non-prompting mode plus an explicit allow-list is required, not
 * optional.
 *
 * Both are overridable by env because the mode's accepted values and the flag spellings
 * have changed across CLI versions; pinning them in code would mean a CLI upgrade
 * breaking synthesis with no way to adjust short of a patch.
 */
const PERMISSION_MODE = process.env.GROUNDWORK_CLAUDE_PERMISSION_MODE ?? "dontAsk";
const RUN_SETTINGS = process.env.GROUNDWORK_CLAUDE_SETTINGS ?? ".claude/run-settings.json";

/**
 * Bare tool names, deliberately.
 *
 * `--allowedTools` does not parse the parenthesised rule syntax on CLI 2.1.235 — passing
 * `Write(.groundwork/runs/**)` grants nothing and the run dies at its first Write. And
 * `allow` rules in a `--settings` file are not honoured either, so a path-scoped ALLOW is
 * simply not available.
 *
 * The scoping therefore lives in the `deny` list in `.claude/run-settings.json`, which
 * IS enforced — verified by making a run try to write `vault/` with and without it. Deny
 * beats allow, so the boundary is real; it is just expressed as a denylist rather than an
 * allowlist. Notably `Bash` is absent here as well as denied there, so a blocked run
 * cannot shell out around the restriction.
 */
const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write"].join(",");

/** The child outlives the request that started it — see `run` below. */
let current: { runId: string; child: ChildProcess } | null = null;

export function stopCurrentRun(): string | null {
  if (!current) return null;
  const { runId, child } = current;
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  current = null;
  return runId;
}

export function currentRunId(): string | null {
  return current?.runId ?? null;
}

/**
 * Map a tool call in the CLI's event stream to something a person can read.
 *
 * Progress has to name what is happening. A spinner for a three-minute run tells the
 * user nothing and makes a working process look hung — the reason claude-coach carries
 * the same mapping.
 */
function friendly(toolName: string, input: Record<string, unknown>): string {
  const base = (v: unknown) => (typeof v === "string" ? v.split(/[\\/]/).pop() : "");
  switch (toolName) {
    case "Read":
      return `Reading ${base(input.file_path) || "a file"}`;
    case "Glob":
    case "Grep":
      return "Searching the project";
    case "Write":
    case "Edit":
      return `Writing ${base(input.file_path) || "the proposal"}`;
    case "Bash":
      return "Running a command";
    case "TodoWrite":
      return "Organising the work";
    case "Task":
      return `Helper agent: ${String(input.description ?? "working")}`;
    default:
      return toolName;
  }
}

/**
 * What the run is told about the code, when there is any.
 *
 * Note what is absent: where the repository is. The run is given a file, not a location,
 * and told plainly that looking for the repository is not an option — otherwise a model
 * that cannot find enough in the excerpts will go hunting, which is the behaviour
 * `assertInstructionScoped` exists to make impossible to authorise.
 *
 * The citation format is the excerpt headings verbatim, because `lib/ai/grounding.ts`
 * verifies a quote by string match against that same file. Asking for a format the check
 * does not parse would produce warnings on honest citations, which trains the reader to
 * ignore warnings.
 */
function excerptClause(excerptsPath: string): string {
  return (
    ` Read "${excerptsPath}" first: it holds excerpts of the repository connected to this ` +
    `project, retrieved for this run, and it is the only view of that code available — the ` +
    `repository itself is not reachable from here, so do not look for it. When a claim is ` +
    `about existing code, set groundedInCode to the excerpt's own heading (path:startLine-` +
    `endLine) with a quote copied from it verbatim. The quote is checked by exact string ` +
    `match against that file, so an invented citation is worse than an honest null.`
  );
}

function instructionFor(job: AiJob, outPath: string, excerptsPath: string | null): string {
  const shared =
    `Write your result as JSON to "${outPath}". ` +
    `Do not create, edit or delete any file inside vault/ — the app applies changes ` +
    `only after the user has reviewed them.` +
    (excerptsPath ? excerptClause(excerptsPath) : "");

  switch (job.kind) {
    case "synthesize":
      return `Read prompts/synthesize.md and execute it for the project at "vault/${job.slug}". ${shared}`;
    case "enhance-card":
      return (
        `Read prompts/enhance-card.md and execute it for card ${job.cardId} of the project ` +
        `at "vault/${job.slug}". ${shared}`
      );
    case "critique":
      return `Read prompts/critique.md and execute it for the project at "vault/${job.slug}". ${shared}`;
  }
}

/** One JSON object per line, but a chunk boundary can split a line in half. */
function* parseLines(buffer: string): Generator<string> {
  for (const line of buffer.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) yield trimmed;
  }
}

/**
 * A real run only works against the default vault location, and says so rather than
 * quietly reading the wrong project.
 *
 * The instruction names the project as `vault/<slug>` — relative, because the run's
 * permissions are globs anchored at the app root and `Write(vault/**)` is what stops the
 * model writing into the data. Two things follow, and both are load-bearing:
 *
 *  - If `GROUNDWORK_VAULT` points somewhere else, that relative path resolves to a
 *    *different* directory than the one the app reads. The run would be handed whatever
 *    happens to sit at `<app>/vault/<slug>` — the wrong project, or nothing.
 *  - Naming the real location instead would not fix it, it would break the boundary: no
 *    glob in `run-settings.json` can match a path outside the app root, and a generated
 *    absolute deny rule is the approach `lib/ai/scope.ts` already rejects as untested. The
 *    vault would be writable by the run.
 *
 * So this refuses. The e2e suite never saw it because it drives the fixture engine, which
 * needs no instruction at all — the combination that breaks is a moved vault plus a real
 * spawn, which is exactly what a developer testing against a throwaway vault would hit.
 */
function assertDefaultVault(cwd: string): void {
  const expected = path.resolve(cwd, "vault");
  const actual = path.resolve(vaultRoot());
  // path.relative rather than a string compare: Windows treats C:\Vault and c:\vault as
  // one directory, and a literal compare would refuse the supported case.
  if (path.relative(expected, actual) === "") return;

  throw new VaultError(
    "escapes_root",
    `Refusing to start an AI run: GROUNDWORK_VAULT points at ${actual}, but a run is told ` +
      `where the project is as a path relative to ${cwd}. Its write permissions are globs ` +
      `anchored there, so a vault anywhere else is both unreadable to the run and ` +
      `unprotected by the rule that keeps the model out of the vault. Use the default ` +
      `location, or run with GROUNDWORK_AI_ENGINE=fixture.`,
  );
}

/**
 * Everything decided before a process exists: where the proposal goes, what the model is
 * told, and whether that is allowed to leave this directory.
 *
 * Extracted from `run` and exported so the scope check has a call site a test can reach.
 * It did not, and a review proved the consequence by replacing the check with
 * `void assertInstructionScoped;` - the entire suite still passed. The guard worked and
 * nothing verified it was installed, which is the same shape of defect as a guard that
 * does not guard.
 */
export function prepareRun(
  job: AiJob,
  runId: string,
  cwd: string,
): { instruction: string; outPath: string } {
  /**
   * The output path is given to the model **relative to cwd**, with forward slashes.
   *
   * This is not cosmetic. Permission rules like `Write(.groundwork/runs/**)` are anchored
   * at the project root, and an absolute path does not match them - so handing the model
   * an absolute path meant its Write was denied and the run finished having composed a
   * perfectly good proposal it could not save. Only fall back to the absolute path if the
   * run directory sits outside cwd, where no relative rule could apply.
   */
  assertDefaultVault(cwd);

  const { proposal: absoluteOut, excerpts: absoluteExcerpts } = runPaths(runId);
  const underCwd = (abs: string): string => {
    const rel = path.relative(cwd, abs).split(path.sep).join("/");
    return rel.startsWith("..") ? abs : rel;
  };
  const outPath = underCwd(absoluteOut);

  /*
   * Excerpts are named only if they exist, and existence is decided here rather than by a
   * flag from the caller. The engine seam takes (job, runId, onEvent) and both engines need
   * the same answer, so the run directory is the channel: whatever `lib/ai/context.ts`
   * wrote before the spawn is what the run is told about. One less argument to forget to
   * pass through, and no way for the instruction to promise a file that is not there.
   */
  const excerptsPath = hasExcerpts(runId) ? underCwd(absoluteExcerpts) : null;

  const instruction = instructionFor(job, outPath, excerptsPath);

  /*
   * Nothing outside the app root may be named to the run.
   *
   * A run's permissions are a denylist anchored at this directory, so a path outside it is
   * not merely unlisted - it is unprotected, and `Write` is granted broadly. The edit that
   * would breach this is adding a connected repository's path to a prompt, so the rule is
   * enforced here rather than remembered. `lib/ai/scope.ts` carries the full argument and
   * the design that makes repo-grounded planning work without it.
   *
   * The two run-directory paths are allowed through: they are the only paths the run
   * legitimately needs outside the root, and only when `GROUNDWORK_RUNS` points elsewhere -
   * the fallback just above. Without them the guard rejected exactly the case it was
   * written to permit, so no run could start on such an install at all. Note that both are
   * inside the run directory; a repository path is never in this list, and adding one would
   * be the edit this guard exists to fail.
   */
  assertInstructionScoped(instruction, cwd, { allow: [absoluteOut, absoluteExcerpts] });

  return { instruction, outPath };
}

export const claudeCliEngine: AiEngine = {
  name: "claude-cli",

  run(job: AiJob, runId: string, onEvent: (e: AiEvent) => void): Promise<void> {
    const cwd = path.resolve(process.cwd());
    const { instruction } = prepareRun(job, runId, cwd);

    return new Promise<void>((resolve, reject) => {
      const args = [
        "-p",
        instruction,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        PERMISSION_MODE,
        "--allowedTools",
        ALLOWED_TOOLS,
        "--settings",
        RUN_SETTINGS,
      ];

      /**
       * Windows needs `cmd /c` to execute a `.cmd`; Node refuses to spawn one directly.
       * That is not a shell — arguments stay a real argv, so no user-supplied text is
       * ever interpolated into a command line. Everywhere else the binary is spawned
       * directly, because wrapping it in `cmd` there would simply fail.
       */
      const child = IS_WINDOWS
        ? spawn("cmd", ["/c", CLAUDE_CMD, ...args], { cwd, windowsHide: true })
        : spawn(CLAUDE_CMD, args, { cwd });

      current = { runId, child };

      let buffer = "";
      let lastLabel = "";
      // Kept so a non-zero exit can say *why* rather than only the code. A rejected flag
      // or a denied tool is otherwise indistinguishable from the model failing.
      let stderrTail = "";

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        void appendStdout(runId, text);

        buffer += text;
        const lastBreak = buffer.lastIndexOf("\n");
        if (lastBreak === -1) return;

        const complete = buffer.slice(0, lastBreak);
        buffer = buffer.slice(lastBreak + 1);

        for (const line of parseLines(complete)) {
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            continue; // not every line is JSON; the log has the raw text
          }

          const e = event as {
            type?: string;
            message?: { content?: { type?: string; name?: string; input?: unknown }[] };
          };
          if (e.type !== "assistant") continue;

          for (const part of e.message?.content ?? []) {
            if (part.type !== "tool_use" || !part.name) continue;
            const label = friendly(part.name, (part.input ?? {}) as Record<string, unknown>);
            // Collapse repeats so eight consecutive reads are one line, not eight.
            if (label === lastLabel) continue;
            lastLabel = label;
            onEvent({ type: "step", label });
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        void appendStdout(runId, text);
        stderrTail = `${stderrTail}${text}`.slice(-2000);
      });

      child.on("error", (err) => {
        current = null;
        reject(new Error(`Could not start the Claude CLI (${CLAUDE_CMD}): ${err.message}`));
      });

      child.on("close", (code) => {
        current = null;
        if (code === 0) {
          onEvent({ type: "done", runId });
          resolve();
          return;
        }
        const detail = stderrTail.trim();
        reject(
          new Error(
            `The Claude CLI exited with code ${code}.` +
              (detail ? ` ${detail.split("\n").slice(-4).join(" ")}` : "") +
              ` Full output is in the run's stdout.log.`,
          ),
        );
      });
    });
  },
};

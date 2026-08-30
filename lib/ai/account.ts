import { spawn } from "node:child_process";

import { claudeCommand } from "./claude-cli";
import { engineName } from "./engine";

/**
 * Which Claude account the CLI is signed into — asked of the CLI, never read off disk.
 *
 * `claude auth status --json` prints one flat object: `loggedIn`, `authMethod`, `email`,
 * `orgName`, `subscriptionType`, and no token of any kind. The CLI also keeps
 * `~/.claude.json` and `~/.claude/.credentials.json`, and reading those would be the easy
 * route — but it is the wrong one twice over. It would be a fifth `fs` exception, into the
 * user's home this time; and on the machine this was built on that file names a different
 * account than the CLI reports, because it is a cache the CLI had not rewritten. The CLI's
 * own answer is the only one that is true.
 *
 * Spawned the same way a run is (`cmd /c` on Windows, an argv array, never a shell string),
 * with a timeout, and the result is memoised for a minute so the rail and every AI panel can
 * ask without spawning a process per render. Fields are whitelisted on the way out.
 */

export type AccountStatus =
  | {
      state: "connected";
      email: string | null;
      orgName: string | null;
      subscriptionType: string | null;
      authMethod: string | null;
    }
  | { state: "signed-out" }
  | { state: "missing"; looked: string }
  | { state: "unknown"; detail: string }
  | { state: "fixture" };

const TTL_MS = 60_000;
const TIMEOUT_MS = 15_000;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Pure: the CLI's stdout and exit code in, a whitelisted status out. */
export function parseAuthStatus(stdout: string, exitCode: number | null): AccountStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      state: "unknown",
      detail:
        exitCode === 0
          ? "The CLI answered, but not with the JSON this app expects."
          : `The CLI exited with code ${exitCode ?? "?"} and no readable answer.`,
    };
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  if (obj.loggedIn === true) {
    return {
      state: "connected",
      email: str(obj.email),
      orgName: str(obj.orgName),
      subscriptionType: str(obj.subscriptionType),
      authMethod: str(obj.authMethod),
    };
  }
  if (obj.loggedIn === false) return { state: "signed-out" };
  return { state: "unknown", detail: "The CLI answered without saying whether it is signed in." };
}

function probe(): Promise<AccountStatus> {
  const cmd = claudeCommand();
  const args = ["auth", "status", "--json"];

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (value: AccountStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child =
        process.platform === "win32"
          ? spawn("cmd", ["/c", cmd, ...args], { windowsHide: true })
          : spawn(cmd, args);
    } catch (e) {
      finish({ state: "unknown", detail: (e as Error).message });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ state: "unknown", detail: "The CLI did not answer within 15 seconds." });
    }, TIMEOUT_MS);

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr = `${stderr}${d.toString("utf8")}`.slice(-600);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(
        err.code === "ENOENT"
          ? { state: "missing", looked: cmd }
          : { state: "unknown", detail: err.message },
      );
    });
    child.on("close", (code) => {
      /*
       * `cmd /c` with a missing .cmd does not raise ENOENT; it exits non-zero and complains on
       * stderr - in the shell's own language, so the words are not matched. A CLI that is
       * there always prints JSON, signed in or not; nothing on stdout plus a failure is a CLI
       * that could not be run at all.
       */
      if (!stdout.trim() && code !== 0) {
        finish({ state: "missing", looked: cmd });
        return;
      }
      finish(parseAuthStatus(stdout, code));
    });
  });
}

let cache: { at: number; value: AccountStatus } | null = null;
let inFlight: Promise<AccountStatus> | null = null;

export async function cliAccount(opts: { refresh?: boolean } = {}): Promise<AccountStatus> {
  if (engineName() === "fixture") return { state: "fixture" };
  if (!opts.refresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  // One probe at a time. Concurrent askers - several panels mounting, a burst of refreshes -
  // share the process rather than each spawning their own.
  if (!inFlight) {
    inFlight = probe()
      .then((value) => {
        cache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** What the Settings page shows beside the status: how the app would reach the CLI. */
export function accountContext(): { engine: string; command: string } {
  return { engine: engineName(), command: claudeCommand() };
}

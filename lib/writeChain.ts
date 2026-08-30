/**
 * One write chain per file.
 *
 * Every write in this app carries the mtime the caller last saw, and the vault refuses with
 * a 409 when the file has moved on. That precondition only works if the *next* write carries
 * the mtime the *previous* write returned — and a component that reads the mtime out of its
 * render closure gets that wrong the moment two edits land in one tick: both carry the same
 * baseline, the second is refused, and the user sees a conflict on a file nobody else
 * touched. Greying the controls while a request is in flight does not fix it; a keyboard
 * Enter and a checkbox change can still share a tick.
 *
 * So the chain owns the baseline. Writes run strictly in order, each carrying the mtime the
 * one before it produced. A failure rejects everything already queued behind it, because a
 * later edit was computed on top of the failed one and landing it alone would write the
 * failed edit anyway while the screen shows it rolled back. A conflict locks the chain until
 * the caller reloads the file and calls `reset` — never retried with a fresh mtime, since a
 * silent retry is exactly the clobber the precondition exists to prevent.
 *
 * `ProjectDocProvider` does this for project.md inline in a component. This is the same rule
 * as a pure module, so a card drawer can use it and a unit test can hold it to its contract.
 */

export interface WriteResult {
  mtimeMs: number;
}

export type WritePayload = Record<string, unknown>;

export interface WriteChain {
  /** Runs after every earlier write; the request carries the mtime the previous one returned. */
  enqueue(payload: WritePayload): Promise<WriteResult>;
  /** True after a 409 until `reset` — every enqueue is refused meanwhile. */
  conflicted(): boolean;
  /** After the caller reloaded the file: a new baseline, and the conflict is cleared. */
  reset(mtimeMs: number): void;
  /** Resolves once nothing is running or queued. */
  idle(): Promise<void>;
  /** The last mtime a write confirmed (or the initial one). */
  mtimeMs(): number;
}

export interface WriteChainOptions {
  initialMtimeMs: number;
  /** Performs one write. Must reject with an error carrying `code: "conflict"` on a 409. */
  send: (payload: WritePayload, expectedMtimeMs: number) => Promise<WriteResult>;
  /** Fires once when the chain locks on a conflict. */
  onConflict?: () => void;
}

interface Job {
  payload: WritePayload;
  resolve: (r: WriteResult) => void;
  reject: (e: unknown) => void;
}

export interface ChainError extends Error {
  code: "conflict" | "skipped";
  status?: number;
}

export function isConflict(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "conflict";
}

function conflictError(): ChainError {
  return Object.assign(
    new Error("This card changed on disk since you loaded it. Reload it before saving so nothing is lost."),
    { code: "conflict" as const, status: 409 },
  );
}

function skippedError(): ChainError {
  return Object.assign(new Error("An earlier save failed, so this one was not attempted."), {
    code: "skipped" as const,
  });
}

export function createWriteChain(opts: WriteChainOptions): WriteChain {
  let mtime = opts.initialMtimeMs;
  let conflicted = false;
  let running = false;
  const queue: Job[] = [];
  let idleWaiters: (() => void)[] = [];

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) break;
        try {
          const result = await opts.send(job.payload, mtime);
          mtime = result.mtimeMs;
          job.resolve(result);
        } catch (e) {
          const conflict = isConflict(e);
          if (conflict && !conflicted) {
            conflicted = true;
            opts.onConflict?.();
          }
          job.reject(e);
          // Everything behind this write was computed on top of it. Drop it all.
          while (queue.length > 0) {
            queue.shift()?.reject(conflict ? e : skippedError());
          }
        }
      }
    } finally {
      running = false;
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  return {
    enqueue(payload) {
      if (conflicted) return Promise.reject(conflictError());
      return new Promise<WriteResult>((resolve, reject) => {
        queue.push({ payload, resolve, reject });
        void pump();
      });
    },
    conflicted: () => conflicted,
    reset(mtimeMs) {
      mtime = mtimeMs;
      conflicted = false;
    },
    idle() {
      if (!running && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    mtimeMs: () => mtime,
  };
}

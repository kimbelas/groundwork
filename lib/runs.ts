import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { VaultError } from "./errors";
import { ProposalSchema, RunRecordSchema, type Proposal, type RunRecord } from "./ai/types";

/**
 * Storage for AI runs, under `.groundwork/runs/<runId>/`.
 *
 * This is the second module permitted to touch disk, and the exception is deliberate
 * rather than convenient: it never resolves a path inside `vault/`. Keeping run
 * artefacts out of `lib/vault.ts` is what lets the spawned CLI be granted write access
 * to exactly one directory and nothing else. Every path here is validated and proven to
 * sit under the run root, the same way vault paths are.
 */

const RUN_ID_RE = /^run_\d{8}_\d{4}(?:_\d{1,3})?$/;

export function runsRoot(): string {
  const override = process.env.GROUNDWORK_RUNS;
  return override ? path.resolve(override) : path.join(process.cwd(), ".groundwork", "runs");
}

export function lockFile(): string {
  return path.join(path.dirname(runsRoot()), "run.lock");
}

export function assertRunId(runId: string): string {
  if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) {
    throw new VaultError("invalid_filename", `Not a run id: ${JSON.stringify(runId)}`);
  }
  return runId;
}

function runDir(runId: string): string {
  const root = path.resolve(runsRoot());
  const dir = path.resolve(root, assertRunId(runId));
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new VaultError("escapes_root", "Run path escapes the runs root");
  }
  return dir;
}

export function runPaths(runId: string): {
  dir: string;
  proposal: string;
  record: string;
  stdout: string;
} {
  const dir = runDir(runId);
  return {
    dir,
    proposal: path.join(dir, "proposal.json"),
    record: path.join(dir, "run.json"),
    stdout: path.join(dir, "stdout.log"),
  };
}

/** `run_20260819_0614`, with a counter appended only when that minute is taken. */
export function makeRunId(now: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const base =
    `run_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}`;

  if (!fs.existsSync(path.join(runsRoot(), base))) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}_${i}`;
    if (!fs.existsSync(path.join(runsRoot(), candidate))) return candidate;
  }
  throw new VaultError("already_exists", "Too many runs in one minute");
}

export async function createRun(record: RunRecord): Promise<void> {
  const { dir, record: file } = runPaths(record.runId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(record, null, 2), "utf8");
}

export async function readRun(runId: string): Promise<RunRecord | null> {
  const { record } = runPaths(runId);
  try {
    // The parse must be inside the guard: a record caught mid-write is truncated JSON,
    // and this is read by the brief page, so a throw here would 500 the whole page over
    // a transient state.
    const raw = await fsp.readFile(record, "utf8");
    const parsed = RunRecordSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function updateRun(runId: string, patch: Partial<RunRecord>): Promise<void> {
  const existing = await readRun(runId);
  if (!existing) throw new VaultError("not_found", `No run ${runId}`);
  await createRun({ ...existing, ...patch });
}

/** Newest first. Used to show a "proposal ready" banner when a tab was closed mid-run. */
export async function listRuns(slug?: string): Promise<RunRecord[]> {
  let names: string[];
  try {
    names = await fsp.readdir(runsRoot());
  } catch {
    return [];
  }

  const out: RunRecord[] = [];
  for (const name of names.sort().reverse()) {
    if (!RUN_ID_RE.test(name)) continue;
    // Best-effort per run: one unreadable record must not hide the others, and must
    // never fail the page that is listing them.
    let record: RunRecord | null = null;
    try {
      record = await readRun(name);
    } catch {
      continue;
    }
    if (!record) continue;
    if (slug && record.slug !== slug) continue;
    out.push(record);
  }
  return out;
}

export interface ProposalReadResult {
  ok: boolean;
  proposal?: Proposal;
  /** Raw text, surfaced to the user when validation fails. Never partially applied. */
  raw?: string;
  error?: string;
}

/**
 * Read and validate a run's proposal.
 *
 * A malformed document is reported with its raw text rather than being coerced or
 * silently dropped: partial application is the one outcome worse than a failed run.
 */
export async function readProposal(runId: string): Promise<ProposalReadResult> {
  const { proposal: file } = runPaths(runId);

  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch {
    return { ok: false, error: "The run produced no proposal.json" };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, raw, error: `proposal.json is not valid JSON: ${(e as Error).message}` };
  }

  const parsed = ProposalSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      raw,
      error: parsed.error.issues
        .slice(0, 6)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    };
  }

  return { ok: true, proposal: parsed.data };
}

export async function writeProposal(runId: string, proposal: unknown): Promise<void> {
  const { dir, proposal: file } = runPaths(runId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(proposal, null, 2), "utf8");
}

export async function appendStdout(runId: string, chunk: string): Promise<void> {
  const { dir, stdout } = runPaths(runId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.appendFile(stdout, chunk, "utf8");
}

// ---------------------------------------------------------------- lock

const STALE_LOCK_MS = 30 * 60_000;

export interface LockInfo {
  runId: string;
  startedAt: string;
}

/**
 * One run at a time.
 *
 * `wx` makes the create atomic, so two requests racing cannot both believe they hold
 * the lock. A lock older than thirty minutes is treated as abandoned — a crashed
 * process must not wedge the feature permanently.
 */
export function acquireLock(runId: string): boolean {
  const file = lockFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const payload = JSON.stringify({ runId, startedAt: new Date().toISOString() });

  try {
    fs.writeFileSync(file, payload, { encoding: "utf8", flag: "wx" });
    return true;
  } catch {
    const held = readLock();
    if (held && Date.now() - Date.parse(held.startedAt) > STALE_LOCK_MS) {
      try {
        fs.writeFileSync(file, payload, "utf8");
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function readLock(): LockInfo | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockFile(), "utf8")) as Partial<LockInfo>;
    if (typeof parsed.runId === "string" && typeof parsed.startedAt === "string") {
      return { runId: parsed.runId, startedAt: parsed.startedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export function releaseLock(): void {
  try {
    fs.unlinkSync(lockFile());
  } catch {
    /* already released */
  }
}

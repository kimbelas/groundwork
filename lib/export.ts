import fsp from "node:fs/promises";
import path from "node:path";

import { VaultError } from "./errors";
import { isInside } from "./repo";
import { priorityLabel, sizeLabel } from "./labels";
import type { Assumption, CardMeta, Phase, ProjectMeta, Question, Risk } from "./schema";

/**
 * Export a plan as something an agent can start from.
 *
 * ## The fourth exception to "all disk access goes through lib/vault.ts", and the first
 * ## that writes outside this application
 *
 * `lib/runs.ts` and `lib/index/store.ts` own directories inside the app root.
 * `lib/repo.ts` reaches a third tree and **never writes at all** — that is the whole of
 * its argument, and this module cannot borrow it. It writes into a directory the user
 * names, which is neither the vault nor this app.
 *
 * So it needs its own contract, and the contract is a narrow one:
 *
 * 1. **Two filenames, ever.** `CLAUDE.md` and `TASKS.md`, both constants below. Nothing
 *    here takes a filename from a caller, so no input decides what gets written.
 * 2. **Into an existing directory the user chose.** Absolute, no NUL byte, must already
 *    exist. It will not create a tree: a typo should fail, not scatter files.
 * 3. **Never deletes, never renames anything but its own temp file.** There is no code
 *    path here that removes a user's work.
 * 4. **Refuses the vault and refuses this app's own root.** Writing into the vault would
 *    bypass every precondition `lib/vault.ts` exists to enforce; writing into the app root
 *    would overwrite the instructions the app itself runs under, which is a footgun with a
 *    plausible-looking path.
 * 5. **Preview before write, always.** `previewExport` returns what exists at the target
 *    alongside what would replace it, so an overwrite is a decision rather than a
 *    discovery. And the decision is a **precondition**: `writeExport` refuses to replace a
 *    file the caller has not said it showed the user, so the guarantee survives the gap
 *    between the showing and the writing.
 *
 * `tests/export.test.ts` enforces 1 and 3 by scanning this file, the way
 * `tests/repo.test.ts` enforces the read-only claim in `lib/repo.ts`. A rule stated in a
 * comment is a rule until someone is in a hurry.
 */

/** The only two filenames this module will ever write. */
export const EXPORT_FILES = ["CLAUDE.md", "TASKS.md"] as const;
export type ExportFile = (typeof EXPORT_FILES)[number];

/** Everything the composer needs, passed in so it can be tested without a vault. */
export interface ExportInput {
  slug: string;
  meta: ProjectMeta;
  brief: string;
  phases: Phase[];
  cards: CardMeta[];
  questions: Question[];
  risks: Risk[];
  assumptions: Assumption[];
  /** Raw `log.md` body, newest first, as the vault stores it. */
  log: string;
}

export type ExportContents = Record<ExportFile, string>;

// ---------------------------------------------------------------- composition

function heading(text: string): string {
  return `## ${text}\n\n`;
}

function bullets(lines: string[]): string {
  return lines.length > 0 ? `${lines.map((l) => `- ${l}`).join("\n")}\n\n` : "";
}

/** Cards in the order a person would work them: by phase, then by board order. */
function ordered(cards: CardMeta[]): CardMeta[] {
  return [...cards].sort((a, b) => {
    const pa = a.phase ?? Number.MAX_SAFE_INTEGER;
    const pb = b.phase ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.order - b.order;
  });
}

function phaseName(phases: Phase[], n: number | null): string {
  if (n === null) return "Unphased";
  const match = phases.find((p) => p.n === n);
  return match ? `Phase ${n} — ${match.name}` : `Phase ${n}`;
}

/**
 * Push every heading in spliced prose one level deeper.
 *
 * `log.md` is a document in its own right and its entries are `##`, so splicing it verbatim
 * under a `## Decisions already taken` heading made each decision a *sibling* of "The brief"
 * and "Risks" rather than an entry inside the log. The hierarchy then lies to whatever reads
 * the file, which for this file is the whole audience.
 *
 * Fenced blocks are left alone: a `#` inside a fence is a comment in someone's code sample,
 * not a heading. Six is as deep as markdown goes, so anything already there stays put.
 */
export function demoteHeadings(markdown: string): string {
  let fenced = false;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      const m = /^(#{1,6})(\s+)(.*)$/.exec(line);
      if (!m) return line;
      const hashes = m[1] ?? "";
      return hashes.length >= 6 ? line : `#${hashes}${m[2]}${m[3]}`;
    })
    .join("\n");
}

/**
 * The context file. Written for an agent that has never seen this project.
 *
 * It leads with the brief verbatim rather than a summary of it: a summary is this app's
 * opinion about the user's words, and the whole product argument is that the user's words
 * are the source of truth. Open questions are included **as open questions** — an agent
 * that knows what is undecided asks instead of inventing, which is the same bet the
 * planning stage makes.
 */
function composeClaudeMd(input: ExportInput): string {
  const { meta, brief, phases, cards, questions, risks, assumptions, log } = input;
  const open = questions.filter((q) => q.status === "open");
  const answered = questions.filter((q) => q.status === "answered" && q.answer);

  let out = `# ${meta.name}\n\n`;
  out += `Planned in Groundwork. This file is generated — edit the plan there, not here.\n\n`;
  out += `**Stage:** ${meta.stage} · **Archetype:** ${meta.archetype}\n\n`;
  out += `---\n\n`;

  out += heading("The brief");
  out += `${brief.trim() || "_No brief was written._"}\n\n`;

  if (phases.length > 0) {
    out += heading("Phases");
    out += bullets(phases.map((p) => `**${p.n}. ${p.name}**${p.goal ? ` — ${p.goal}` : ""}`));
  }

  const byPhase = new Map<string, CardMeta[]>();
  for (const card of ordered(cards)) {
    const key = phaseName(phases, card.phase);
    byPhase.set(key, [...(byPhase.get(key) ?? []), card]);
  }
  if (byPhase.size > 0) {
    out += heading("The work");
    for (const [name, group] of byPhase) {
      out += `### ${name}\n\n`;
      out += bullets(
        group.map(
          (c) =>
            `${c.title} — ${priorityLabel(c.priority)}, ${sizeLabel(c.size)}` +
            `${c.blocked ? ", blocked" : ""} (${c.column})`,
        ),
      );
    }
  }

  if (open.length > 0) {
    out += heading("Open questions — ask, do not guess");
    out += bullets(open.map((q) => q.text));
  }

  if (answered.length > 0) {
    out += heading("Settled questions");
    out += bullets(answered.map((q) => `${q.text} → **${q.answer}**`));
  }

  if (assumptions.length > 0) {
    out += heading("Assumptions");
    out += bullets(
      assumptions.map((a) => `${a.text}${a.validated ? " (validated)" : " (unvalidated)"}`),
    );
  }

  if (risks.length > 0) {
    out += heading("Risks");
    out += bullets(
      risks.map(
        (r) =>
          `${r.text} — likelihood ${r.likelihood}, impact ${r.impact}` +
          `${r.mitigation ? `. Mitigation: ${r.mitigation}` : ""}`,
      ),
    );
  }

  const decisions = log.trim();
  if (decisions) {
    out += heading("Decisions already taken");
    out += `${demoteHeadings(decisions)}\n\n`;
  }

  return out;
}

/**
 * The checklist. Deliberately just a list of boxes.
 *
 * Acceptance criteria are not repeated here — they live in the cards, and duplicating them
 * into a second file means two copies that drift. This file answers "what is left", which
 * is the one question a checklist should answer.
 */
function composeTasks(input: ExportInput): string {
  const { meta, phases, cards } = input;

  let out = `# ${meta.name} — tasks\n\n`;
  out += `Generated from Groundwork. Boxes are yours to tick; the plan lives in the vault.\n\n`;

  const groups = new Map<string, CardMeta[]>();
  for (const card of ordered(cards)) {
    const key = phaseName(phases, card.phase);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }

  if (groups.size === 0) {
    out += `_No cards yet._\n`;
    return out;
  }

  for (const [name, group] of groups) {
    out += `## ${name}\n\n`;
    for (const card of group) {
      const done = card.column.toLowerCase() === "done";
      out += `- [${done ? "x" : " "}] ${card.title}`;
      out += ` _(${priorityLabel(card.priority)}, ${sizeLabel(card.size)})_\n`;
    }
    out += `\n`;
  }

  return out;
}

export function composeExport(input: ExportInput): ExportContents {
  return {
    "CLAUDE.md": composeClaudeMd(input),
    "TASKS.md": composeTasks(input),
  };
}

// ---------------------------------------------------------------- the target

/**
 * Validate a directory the user chose to export into.
 *
 * Deliberately does not create it. A path that does not exist is far more likely to be a
 * typo than an intention, and the cost of guessing wrong is a folder tree in a place nobody
 * meant — while the cost of refusing is one clear message.
 */
export async function validateTarget(input: unknown, vaultPath: string): Promise<string> {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new VaultError("invalid_document", "Choose a folder to export into.");
  }
  const raw = input.trim();

  // A NUL truncates the path at the syscall layer, so a validated prefix could resolve
  // somewhere else entirely. Same reasoning as `containedPath` in lib/paths.ts.
  if (raw.includes("\0")) {
    throw new VaultError("escapes_root", "A folder path cannot contain a NUL byte.");
  }
  if (!path.isAbsolute(raw)) {
    throw new VaultError(
      "invalid_document",
      `An export target must be an absolute path. Got ${JSON.stringify(raw)} — a relative ` +
        `path would resolve against whatever directory the server happens to be running in.`,
    );
  }

  const target = path.resolve(raw);
  const vault = path.resolve(vaultPath);
  const appRoot = path.resolve(process.cwd());

  /*
   * The vault is refused in both directions.
   *
   * Writing into it would put a generated file where `lib/vault.ts` guarantees every write
   * carries an mtime precondition and a snapshot — and a project folder containing a
   * generated CLAUDE.md would then be read back as part of the plan it was generated from.
   */
  if (isInside(vault, target) || isInside(target, vault)) {
    throw new VaultError(
      "escapes_root",
      "That folder is inside the vault (or contains it). Export somewhere else — the vault " +
        "is the plan, not a build output.",
    );
  }

  /*
   * And this application's own root, which is the dangerous near-miss: exporting here
   * overwrites the CLAUDE.md that governs how this app is worked on. Only the root itself
   * and its ancestors are refused; a subdirectory is the user's business.
   */
  if (isInside(target, appRoot)) {
    throw new VaultError(
      "escapes_root",
      "That folder is Groundwork's own directory (or contains it). Exporting there would " +
        "overwrite this app's CLAUDE.md.",
    );
  }

  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(target);
  } catch {
    throw new VaultError(
      "not_found",
      `No folder at ${target}. Create it first — export will not make directories, because ` +
        `a typo should fail rather than scatter files.`,
    );
  }
  if (!stat.isDirectory()) {
    throw new VaultError("invalid_document", `${target} is a file, not a folder.`);
  }

  return target;
}

// ---------------------------------------------------------------- preview and write

export interface ExportFilePreview {
  name: ExportFile;
  /** What would be written. */
  next: string;
  /** What is there now, or null when the file does not exist yet. */
  current: string | null;
  /** True when the file exists and differs — the case that needs a decision. */
  clobbers: boolean;
}

export interface ExportPreview {
  target: string;
  files: ExportFilePreview[];
}

/**
 * What an export would do, without doing any of it.
 *
 * The `current` contents come back so the UI can show a real diff. An overwrite prompt that
 * cannot say what it is about to destroy is a prompt people click through.
 */
export async function previewExport(
  contents: ExportContents,
  target: string,
): Promise<ExportPreview> {
  const files: ExportFilePreview[] = [];

  for (const name of EXPORT_FILES) {
    const next = contents[name];
    let current: string | null = null;
    try {
      current = await fsp.readFile(path.join(target, name), "utf8");
    } catch {
      current = null;
    }
    files.push({ name, next, current, clobbers: current !== null && current !== next });
  }

  return { target, files };
}

const TRANSIENT_WRITE_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Write one file via a temp name and a rename.
 *
 * The rename retries on EPERM/EACCES/EBUSY for the same reason `lib/vault.ts` does: on
 * Windows the rename fails while any other process holds a handle to the destination, and
 * the condition clears in milliseconds. An editor with the exported CLAUDE.md open is the
 * normal case here, not an unusual one.
 */
async function writeOne(target: string, name: ExportFile, contents: string): Promise<void> {
  const dest = path.join(target, name);
  /*
   * Unique per call, not per process.
   *
   * The dev server is one process, so a pid alone gave both files of one export - and both
   * files of two simultaneous exports - the same temp path. `lib/vault.ts` adds a timestamp
   * for the same reason.
   */
  const tmp = path.join(
    target,
    `.groundwork-export-${process.pid}-${Date.now().toString(36)}-${name}.tmp`,
  );

  try {
    await fsp.writeFile(tmp, contents, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fsp.rename(tmp, dest);
        break;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? "";
        if (attempt >= 4 || !TRANSIENT_WRITE_ERRORS.has(code)) throw e;
        await delay(10 * (attempt + 1));
      }
    }
  } catch (e) {
    // The temp file is this module's own and is removed only on a failed write of it.
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export interface ExportResult {
  target: string;
  written: ExportFile[];
  overwritten: ExportFile[];
}

/**
 * Files this preview would replace that the caller has not said it showed the user.
 *
 * The precondition for an overwrite, and it is required rather than optional for the reason
 * CLAUDE.md gives about `expectedMtimeMs`: an optional precondition is a last-writer-wins
 * clobber waiting to happen. The concrete hole it closes is narrow and real — preview a
 * folder with no `CLAUDE.md`, something creates one, click write, and a file the user was
 * never shown is gone. "Never clobbers without showing the diff" has to survive the gap
 * between the showing and the clobbering.
 */
export function unacknowledgedClobbers(
  preview: ExportPreview,
  acknowledged: readonly string[],
): ExportFile[] {
  const seen = new Set(acknowledged);
  return preview.files.filter((f) => f.clobbers && !seen.has(f.name)).map((f) => f.name);
}

/**
 * Write the export.
 *
 * Takes a preview rather than composing its own, so the bytes that land are the bytes that
 * were checked against the target. Which files may be written is decided here from
 * `EXPORT_FILES`, never by anything a caller passes — a preview naming a third path writes
 * nothing.
 *
 * `acknowledged` names the files the caller has shown the user as being replaced. Anything
 * this preview would replace that is not in that list stops the write, because the user's
 * decision was made about a different state of the folder than the one on disk now.
 */
export async function writeExport(
  preview: ExportPreview,
  acknowledged: readonly string[] = [],
): Promise<ExportResult> {
  const surprises = unacknowledgedClobbers(preview, acknowledged);
  if (surprises.length > 0) {
    throw new VaultError(
      "conflict",
      `${surprises.join(" and ")} ${surprises.length === 1 ? "was" : "were"} created or ` +
        `changed in that folder since the preview. Preview again to see what would be ` +
        `replaced.`,
    );
  }

  const written: ExportFile[] = [];
  const overwritten: ExportFile[] = [];

  for (const name of EXPORT_FILES) {
    const file = preview.files.find((f) => f.name === name);
    if (!file) continue;
    await writeOne(preview.target, name, file.next);
    written.push(name);
    if (file.current !== null) overwritten.push(name);
  }

  return { target: preview.target, written, overwritten };
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { VaultError } from "./errors";
import {
  buildLinkGraph,
  cardNode,
  projectNode,
  type IndexedCard,
  type IndexedProject,
  type LinkDoc,
  type LinkGraph,
  type NodeId,
} from "./links";
import { ORDER_STEP, orderForIndex, renumber } from "./ordering";
import {
  assertCardFilename,
  assertSlug,
  CARD_FILE_RE,
  cardFilename,
  containedPath,
  slugify,
} from "./paths";
import { buildDoc, readData, replaceBody, replaceData, split } from "./frontmatter";
import {
  CardMetaSchema,
  DEFAULT_COLUMNS,
  ProjectMetaSchema,
  QuestionsSchema,
  RisksSchema,
  RoadmapSchema,
  describeIssues,
  type Assumption,
  type CardMeta,
  type Phase,
  type ProjectMeta,
  type Question,
  type Risk,
} from "./schema";

/**
 * The only module in the app that touches disk.
 *
 * Everything else — route handlers, server components — calls in here. Path
 * validation, the mtime precondition and atomic writes live in one file so there is
 * exactly one place to audit, and `scripts/fs-boundary.js` enforces that at edit time.
 */

// ---------------------------------------------------------------- types

export interface ProjectSummary {
  meta: ProjectMeta;
  cards: CardMeta[];
  phases: Phase[];
  openQuestions: number;
  briefEmpty: boolean;
  lastTouchedMs: number;
  /** Non-fatal problems (a card that would not parse). Shown, never thrown. */
  warnings: string[];
}

export type ProjectEntry =
  | { ok: true; slug: string; summary: ProjectSummary }
  | { ok: false; slug: string; error: string };

export interface Project extends ProjectSummary {
  brief: string;
  /** Precondition token for the next write. */
  mtimeMs: number;
}

export interface RiskRegister {
  risks: Risk[];
  assumptions: Assumption[];
}

// ---------------------------------------------------------------- root & cache

/**
 * `GROUNDWORK_VAULT` lets tests and Playwright point at a throwaway directory. Without
 * it every test run would mutate the developer's real vault.
 */
export function vaultRoot(): string {
  const override = process.env.GROUNDWORK_VAULT;
  return override ? path.resolve(override) : path.join(process.cwd(), "vault");
}

const summaryCache = new Map<string, ProjectEntry>();
let cachedRoot: string | null = null;
let watcher: fs.FSWatcher | null = null;

/**
 * Per-project cache invalidation, driven by a recursive watch.
 *
 * Polling the vault root's mtime cannot work: on NTFS a directory's mtime does not
 * change when a file inside a subdirectory does, so an edit made in Obsidian would
 * never be noticed. If the watch cannot be established we simply stop caching —
 * correctness outranks the few milliseconds it saves.
 */
function ensureWatcher(root: string): void {
  if (cachedRoot === root && watcher) return;

  if (watcher) {
    try {
      watcher.close();
    } catch {
      /* already gone */
    }
    watcher = null;
  }
  summaryCache.clear();
  cachedRoot = root;

  try {
    watcher = fs.watch(root, { recursive: true, persistent: false }, (_event, filename) => {
      // The link graph spans the whole vault, so any change anywhere can alter it.
      // Missing this would leave backlinks stale after an edit made outside the app.
      clearGraph();

      if (!filename) {
        summaryCache.clear();
        return;
      }
      const first = String(filename).split(/[\\/]/)[0];
      if (first) summaryCache.delete(first);
      else summaryCache.clear();
    });
    watcher.on("error", () => {
      summaryCache.clear();
      clearGraph();
      watcher = null;
    });
  } catch {
    watcher = null;
  }
}

function cachingEnabled(): boolean {
  return watcher !== null;
}

export function invalidate(slug?: string): void {
  if (slug) summaryCache.delete(slug);
  else summaryCache.clear();
  // The link graph spans the whole vault, so any change can alter it.
  clearGraph();
}

// ---------------------------------------------------------------- low-level io

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function mtimeOf(file: string): Promise<number> {
  try {
    return (await fsp.stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Read a file and its mtime together.
 *
 * The index needs both for every document it parses. Fetching them in one place lets
 * the loader drop a second recursive walk of the project that existed purely to find
 * the newest timestamp.
 */
async function readWithMtime(file: string): Promise<{ raw: string; mtimeMs: number } | null> {
  try {
    const [raw, stat] = await Promise.all([fsp.readFile(file, "utf8"), fsp.stat(file)]);
    return { raw, mtimeMs: stat.mtimeMs };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Write via a temp file in the same directory, then rename. A crash mid-write leaves
 * the original intact rather than a truncated document — the vault is the database,
 * so a half-written project.md is data loss.
 */
const TRANSIENT_WRITE_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function atomicWrite(file: string, contents: string): Promise<number> {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now().toString(36)}`);

  try {
    await fsp.writeFile(tmp, contents, "utf8");

    /*
     * On Windows, renaming over an existing file fails with EPERM or EBUSY whenever
     * any other process holds a handle to the destination — antivirus scanning the
     * save, Obsidian with the note open, a sync client, or simply a reader that opened
     * it a millisecond ago. The condition clears in single-digit milliseconds, so a
     * few short retries turn a spurious "save failed" into a save. Anything that is
     * still failing after this is a real error and propagates.
     */
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fsp.rename(tmp, file);
        break;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? "";
        if (attempt >= 4 || !TRANSIENT_WRITE_ERRORS.has(code)) throw e;
        await delay(10 * (attempt + 1));
      }
    }
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  return mtimeOf(file);
}

/**
 * The lost-update guard. The brief autosaves on a debounce while an AI apply may also
 * be writing project.md; without this the later write silently destroys the earlier.
 * Callers pass the mtime they read; a mismatch is a 409, never a clobber.
 */
async function assertUnchanged(file: string, expectedMtimeMs: number | undefined): Promise<void> {
  if (expectedMtimeMs === undefined) return;
  const actual = await mtimeOf(file);
  if (actual !== expectedMtimeMs) {
    throw new VaultError(
      "conflict",
      "This file changed on disk since you loaded it. Reload before saving so nothing is lost.",
    );
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- paths

const PROJECT_FILE = "project.md";
const ROADMAP_FILE = "roadmap.md";
const QUESTIONS_FILE = "questions.md";
const RISKS_FILE = "risks.md";
const LOG_FILE = "log.md";
const CARDS_DIR = "cards";

function projectPath(root: string, slug: string, ...rest: string[]): string {
  return containedPath(root, slug, ...rest);
}

// ---------------------------------------------------------------- loading

async function loadCards(
  root: string,
  slug: string,
  warnings: string[],
): Promise<{ cards: CardMeta[]; newest: number }> {
  const dir = projectPath(root, slug, CARDS_DIR);
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return { cards: [], newest: 0 };
  }

  const wanted = names.filter((n) => CARD_FILE_RE.test(n)).sort();

  // Read the column concurrently. Serial awaits made a project with twenty cards twenty
  // round-trips deep, and the rail renders in the root layout, so every page paid it.
  const results = await Promise.all(
    wanted.map(async (name) => ({
      name,
      doc: await readWithMtime(projectPath(root, slug, CARDS_DIR, name)),
    })),
  );

  const cards: CardMeta[] = [];
  let newest = 0;

  for (const { name, doc } of results) {
    if (!doc) continue;
    if (doc.mtimeMs > newest) newest = doc.mtimeMs;

    const parsed = CardMetaSchema.safeParse(readData(doc.raw));
    if (!parsed.success) {
      // One malformed card must not take the board down with it.
      warnings.push(`${name}: ${describeIssues(parsed.error)}`);
      continue;
    }
    cards.push(parsed.data);
  }

  cards.sort((a, b) => a.order - b.order || a.id - b.id);
  return { cards, newest };
}

async function loadSummary(root: string, slug: string): Promise<ProjectEntry> {
  const warnings: string[] = [];

  const projFile = projectPath(root, slug, PROJECT_FILE);
  const project = await readWithMtime(projFile);
  if (project === null) {
    return { ok: false, slug, error: `${PROJECT_FILE} is missing` };
  }

  const data = readData(project.raw);
  // The folder name is authoritative for slug: a mismatched `slug:` in frontmatter
  // would silently break every link that resolves by folder.
  const parsed = ProjectMetaSchema.safeParse({ name: slug, ...data, slug });
  if (!parsed.success) {
    return { ok: false, slug, error: describeIssues(parsed.error) };
  }

  // The side documents and the card column are independent reads.
  const [cardResult, roadmapDoc, questionsDoc, risksMtime] = await Promise.all([
    loadCards(root, slug, warnings),
    readWithMtime(projectPath(root, slug, ROADMAP_FILE)),
    readWithMtime(projectPath(root, slug, QUESTIONS_FILE)),
    mtimeOf(projectPath(root, slug, RISKS_FILE)),
  ]);

  const roadmap = RoadmapSchema.safeParse(roadmapDoc ? readData(roadmapDoc.raw) : {});
  if (roadmapDoc && !roadmap.success) {
    warnings.push(`${ROADMAP_FILE}: ${describeIssues(roadmap.error)}`);
  }

  const questions = QuestionsSchema.safeParse(questionsDoc ? readData(questionsDoc.raw) : {});
  if (questionsDoc && !questions.success) {
    warnings.push(`${QUESTIONS_FILE}: ${describeIssues(questions.error)}`);
  }

  /*
   * "Last touched" comes from the documents already read rather than from a second
   * recursive walk of the project. The old walk statted every file a second time on
   * every index build, and since the rail renders in the root layout, every page in
   * the app paid for it.
   */
  const lastTouchedMs = Math.max(
    project.mtimeMs,
    cardResult.newest,
    roadmapDoc?.mtimeMs ?? 0,
    questionsDoc?.mtimeMs ?? 0,
    risksMtime,
  );

  const summary: ProjectSummary = {
    meta: parsed.data,
    cards: cardResult.cards,
    phases: roadmap.success ? [...roadmap.data.phases].sort((a, b) => a.n - b.n) : [],
    openQuestions: questions.success
      ? questions.data.questions.filter((q) => q.status === "open").length
      : 0,
    briefEmpty: split(project.raw).body.trim().length === 0,
    lastTouchedMs,
    warnings,
  };

  return { ok: true, slug, summary };
}

/**
 * In-flight index builds, keyed by project.
 *
 * Without this, N concurrent requests each rebuild the same project's summary from
 * scratch — a thundering herd that turned a 400ms page render into fifteen seconds
 * under parallel load. Callers arriving while a build is running share its promise.
 */
const inFlight = new Map<string, Promise<ProjectEntry>>();

async function loadSummaryShared(root: string, slug: string): Promise<ProjectEntry> {
  const existing = inFlight.get(slug);
  if (existing) return existing;

  const pending = loadSummary(root, slug).catch(
    (e): ProjectEntry => ({ ok: false, slug, error: (e as Error).message }),
  );
  inFlight.set(slug, pending);

  try {
    return await pending;
  } finally {
    inFlight.delete(slug);
  }
}

// ---------------------------------------------------------------- public reads

export async function listProjectSlugs(): Promise<string[]> {
  const root = vaultRoot();
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    // A vault that is missing, locked, or mid-write yields no projects rather than an
    // exception. The rail renders in the root layout, so a throw here would take down
    // every page in the app over a transient filesystem state.
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

export async function listProjects(): Promise<ProjectEntry[]> {
  const root = vaultRoot();
  ensureWatcher(root);

  const slugs = await listProjectSlugs();

  /*
   * Projects load concurrently. Serially, a vault of twenty projects meant twenty
   * sequential directory reads before the rail could render — and the rail is in the
   * root layout, so that latency was on every page.
   *
   * Listing is best-effort per project: a directory being rewritten underneath us
   * (Obsidian saving, an AI apply landing) can surface as EPERM or EBUSY on Windows
   * rather than the ENOENT the readers handle. One project in that state becomes one
   * unreadable row, never a failed page.
   */
  const out = await Promise.all(
    slugs.map(async (slug): Promise<ProjectEntry> => {
      // A directory whose name is not a legal slug is reported, not skipped — a
      // silently invisible project is worse than a visible complaint.
      if (!isLegalSlug(slug)) {
        return { ok: false, slug, error: "Folder name is not a valid project slug" };
      }

      const cached = cachingEnabled() ? summaryCache.get(slug) : undefined;
      if (cached) return cached;

      const entry = await loadSummaryShared(root, slug);
      // A transient failure must not be cached, or the row stays broken until restart.
      if (cachingEnabled() && entry.ok) summaryCache.set(slug, entry);
      return entry;
    }),
  );

  out.sort((a, b) => {
    const at = a.ok ? a.summary.lastTouchedMs : 0;
    const bt = b.ok ? b.summary.lastTouchedMs : 0;
    return bt - at || a.slug.localeCompare(b.slug);
  });
  return out;
}

function isLegalSlug(slug: string): boolean {
  try {
    assertSlug(slug);
    return true;
  } catch {
    return false;
  }
}

export async function getProject(slug: string): Promise<Project> {
  assertSlug(slug);
  const root = vaultRoot();
  ensureWatcher(root);

  const entry = await loadSummaryShared(root, slug);
  if (!entry.ok) {
    throw new VaultError("not_found", `Cannot load project "${slug}": ${entry.error}`);
  }

  const doc = await readWithMtime(projectPath(root, slug, PROJECT_FILE));

  return {
    ...entry.summary,
    brief: doc ? split(doc.raw).body : "",
    mtimeMs: doc?.mtimeMs ?? 0,
  };
}

export async function getQuestions(slug: string): Promise<Question[]> {
  assertSlug(slug);
  const raw = await readIfPresent(projectPath(vaultRoot(), slug, QUESTIONS_FILE));
  if (!raw) return [];
  const parsed = QuestionsSchema.safeParse(readData(raw));
  return parsed.success ? parsed.data.questions : [];
}

export async function getRisks(slug: string): Promise<RiskRegister> {
  assertSlug(slug);
  const raw = await readIfPresent(projectPath(vaultRoot(), slug, RISKS_FILE));
  if (!raw) return { risks: [], assumptions: [] };
  const parsed = RisksSchema.safeParse(readData(raw));
  return parsed.success ? parsed.data : { risks: [], assumptions: [] };
}

export async function getLog(slug: string): Promise<string> {
  assertSlug(slug);
  return (await readIfPresent(projectPath(vaultRoot(), slug, LOG_FILE))) ?? "";
}

// ---------------------------------------------------------------- public writes

/** Rewrites the brief. Frontmatter bytes are carried across untouched. */
export async function writeBrief(
  slug: string,
  body: string,
  expectedMtimeMs?: number,
): Promise<{ mtimeMs: number }> {
  assertSlug(slug);
  const file = projectPath(vaultRoot(), slug, PROJECT_FILE);

  const raw = await readIfPresent(file);
  if (raw === null) throw new VaultError("not_found", `No such project: ${slug}`);

  await assertUnchanged(file, expectedMtimeMs);

  const mtimeMs = await atomicWrite(file, replaceBody(raw, body));
  invalidate(slug);
  return { mtimeMs };
}

/** Rewrites project frontmatter. Body bytes are carried across untouched. */
/**
 * The fields a caller may patch on `project.md`.
 *
 * An allowlist rather than `Partial<ProjectMeta>`: `slug` is identity and `created` is
 * history, and neither should be reachable through an ordinary edit.
 *
 * `repo` is the one field that can be *removed*, so it needs a third state the others do
 * not have. `null` means disconnect; an absent key means leave it alone. `undefined` is
 * treated as absent, matching how JS reads a missing property - it is filtered out below
 * rather than merged, so a caller building a patch object programmatically cannot wipe
 * the field by accident.
 */
export type ProjectMetaPatch = Partial<
  Pick<ProjectMeta, "name" | "stage" | "health" | "archetype" | "columns">
> & { repo?: string | null };

export async function patchProjectMeta(
  slug: string,
  patch: ProjectMetaPatch,
  expectedMtimeMs?: number,
): Promise<{ mtimeMs: number; meta: ProjectMeta }> {
  assertSlug(slug);
  const file = projectPath(vaultRoot(), slug, PROJECT_FILE);

  const raw = await readIfPresent(file);
  if (raw === null) throw new VaultError("not_found", `No such project: ${slug}`);

  await assertUnchanged(file, expectedMtimeMs);

  const current = ProjectMetaSchema.safeParse({ name: slug, ...readData(raw), slug });
  if (!current.success) {
    throw new VaultError("invalid_document", `${PROJECT_FILE} is malformed: ${describeIssues(current.error)}`);
  }

  /*
   * `undefined` in a patch means "not provided", never "clear it".
   *
   * Spreading it through would put a present-but-empty key into the merged object. That
   * used to be unreachable because every patchable field was required or had a default,
   * so zod filled it in; `repo` is the first optional one, and with it the spread became
   * a way to delete a field by passing nothing.
   */
  const { repo, ...fields } = patch;
  const provided = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );

  const merged: Record<string, unknown> = {
    ...current.data,
    ...provided,
    slug,
    updated: today(),
  };

  // Only `null` disconnects, and it does so by removing the key rather than writing an
  // empty value - a `repo:` line with nothing after it would parse back as null and read
  // like a broken setting rather than an absent one.
  if (repo === null) delete merged.repo;
  else if (repo !== undefined) merged.repo = repo;

  const next = ProjectMetaSchema.safeParse(merged);
  if (!next.success) {
    throw new VaultError("invalid_document", describeIssues(next.error));
  }

  /*
   * Carry across frontmatter keys the schema does not know about.
   *
   * A zod object strips unknown keys, so writing the parsed result straight out DELETES
   * anything a person added by hand in Obsidian - a `tags:` line, an `aliases:`, a field
   * from a plugin. The vault is meant to be editable outside this app, so discarding what
   * someone wrote there is data loss, not tidiness.
   *
   * It is also why adding an optional field to the schema is not a free change: before
   * `repo` existed, a write from an older build would have erased it. The schema is the
   * allowlist for what this app manages; everything else belongs to the user.
   *
   * Unknown keys go last rather than back where they were. Known keys already come out in
   * schema order - that is how zod builds the object - so interleaving would mean
   * reordering the whole block on every write for no gain. Appending is stable after the
   * first write and keeps the frontmatter readable.
   */
  const known = new Set(Object.keys(ProjectMetaSchema.shape));
  const carried = Object.entries(readData(raw)).filter(([k]) => !known.has(k));
  const out: Record<string, unknown> = { ...next.data };
  for (const [k, v] of carried) out[k] = v;

  const mtimeMs = await atomicWrite(file, replaceData(raw, out));
  invalidate(slug);
  return { mtimeMs, meta: next.data };
}

export interface CreateProjectInput {
  name: string;
  slug?: string;
  archetype?: ProjectMeta["archetype"];
}

export async function createProject(input: CreateProjectInput): Promise<ProjectMeta> {
  const slug = assertSlug(input.slug?.trim() || slugify(input.name));
  const root = vaultRoot();
  const dir = projectPath(root, slug);

  try {
    await fsp.mkdir(dir, { recursive: false });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      throw new VaultError("already_exists", `A project called "${slug}" already exists`);
    }
    throw e;
  }

  const now = today();
  const meta: ProjectMeta = {
    name: input.name.trim() || slug,
    slug,
    stage: "idea",
    health: "green",
    archetype: input.archetype ?? "internal-tool",
    columns: [...DEFAULT_COLUMNS],
    created: now,
    updated: now,
  };

  await fsp.mkdir(path.join(dir, CARDS_DIR), { recursive: true });
  await atomicWrite(projectPath(root, slug, PROJECT_FILE), buildDoc(meta as Record<string, unknown>, ""));
  await atomicWrite(projectPath(root, slug, ROADMAP_FILE), buildDoc({ phases: [] }, ""));
  await atomicWrite(projectPath(root, slug, QUESTIONS_FILE), buildDoc({ questions: [] }, ""));
  await atomicWrite(projectPath(root, slug, RISKS_FILE), buildDoc({ risks: [], assumptions: [] }, ""));
  await atomicWrite(projectPath(root, slug, LOG_FILE), "");

  invalidate(slug);
  return meta;
}

/**
 * Card ids are assigned here and never by the AI, so a proposal cannot collide with an
 * existing card. Ids are not reused after delete: a trashed card keeps its id so links
 * and snapshots stay meaningful.
 */
export async function nextCardId(slug: string): Promise<number> {
  assertSlug(slug);
  const root = vaultRoot();
  let names: string[] = [];
  try {
    names = await fsp.readdir(projectPath(root, slug, CARDS_DIR));
  } catch {
    /* no cards yet */
  }

  let max = 0;
  for (const dir of [CARDS_DIR, ".trash"]) {
    let list: string[] = [];
    try {
      list = dir === CARDS_DIR ? names : await fsp.readdir(projectPath(root, slug, dir));
    } catch {
      continue;
    }
    for (const n of list) {
      const m = /^(\d{4})-/.exec(n);
      if (m?.[1]) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

// ---------------------------------------------------------------- cards

export interface Card extends CardMeta {
  body: string;
  file: string;
  mtimeMs: number;
}

async function findCardFile(root: string, slug: string, id: number): Promise<string | null> {
  const dir = projectPath(root, slug, CARDS_DIR);
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return null;
  }
  const prefix = `${String(id).padStart(4, "0")}-`;
  const match = names.find((n) => CARD_FILE_RE.test(n) && n.startsWith(prefix));
  return match ?? null;
}

export async function getCard(slug: string, id: number): Promise<Card> {
  assertSlug(slug);
  const root = vaultRoot();

  const name = await findCardFile(root, slug, id);
  if (!name) throw new VaultError("not_found", `No card ${id} in ${slug}`);

  const file = projectPath(root, slug, CARDS_DIR, assertCardFilename(name));
  const raw = await readIfPresent(file);
  if (raw === null) throw new VaultError("not_found", `No card ${id} in ${slug}`);

  const parsed = CardMetaSchema.safeParse(readData(raw));
  if (!parsed.success) {
    throw new VaultError("invalid_document", `${name}: ${describeIssues(parsed.error)}`);
  }

  return { ...parsed.data, body: split(raw).body, file: name, mtimeMs: await mtimeOf(file) };
}

export async function createCard(
  slug: string,
  input: { title: string; column: string; phase?: number | null },
): Promise<Card> {
  assertSlug(slug);
  const root = vaultRoot();

  const project = await getProject(slug);
  if (!project.meta.columns.includes(input.column)) {
    throw new VaultError("invalid_document", `No column "${input.column}" in this project`);
  }

  const id = await nextCardId(slug);
  const titleSlug = slugify(input.title) || `card-${id}`;
  const name = assertCardFilename(cardFilename(id, titleSlug));
  const file = projectPath(root, slug, CARDS_DIR, name);

  const siblings = project.cards.filter((c) => c.column === input.column);
  const last = siblings.reduce((max, c) => Math.max(max, c.order), 0);

  const now = today();
  const meta: CardMeta = {
    id,
    title: input.title.trim(),
    column: input.column,
    phase: input.phase ?? null,
    priority: "P2",
    size: "M",
    confidence: 0.5,
    blocked: false,
    order: last + ORDER_STEP,
    created: now,
    updated: now,
  };

  const body = "\n\n## Acceptance criteria\n\n- [ ] \n";
  await atomicWrite(file, buildDoc(meta as unknown as Record<string, unknown>, body));
  invalidate(slug);

  return { ...meta, body, file: name, mtimeMs: await mtimeOf(file) };
}

/** Moves the card file into `.trash/`. Ids are never reused, so links stay meaningful. */
export async function trashCard(slug: string, id: number): Promise<void> {
  assertSlug(slug);
  const root = vaultRoot();

  const name = await findCardFile(root, slug, id);
  if (!name) throw new VaultError("not_found", `No card ${id} in ${slug}`);

  const from = projectPath(root, slug, CARDS_DIR, assertCardFilename(name));
  const to = projectPath(root, slug, ".trash", name);

  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.rename(from, to);
  invalidate(slug);
}

/**
 * Rewrite only a card's `order`, from a fresh read.
 *
 * Renumbering touches every card in a column, and those files are not the one the user
 * is editing — so rather than carry stale content, each is re-read immediately before
 * its single derived field is changed. That keeps the window in which a concurrent edit
 * could be lost down to the read-modify-write itself.
 */
async function setCardOrder(root: string, slug: string, name: string, order: number): Promise<void> {
  const file = projectPath(root, slug, CARDS_DIR, assertCardFilename(name));
  const raw = await readIfPresent(file);
  if (raw === null) return;

  const data = readData(raw);
  if (data.order === order) return;

  await atomicWrite(file, replaceData(raw, { ...data, order }));
}

export interface MoveResult {
  /** Files rewritten. One in the common case; the whole column after a renumber. */
  touched: number;
  renumbered: boolean;
}

/**
 * Move a card to `column` at `index`.
 *
 * The client says *where*, never what `order` value to use — ordering arithmetic is the
 * server's, so two clients cannot disagree about it. The moved card carries a mtime
 * precondition; the renumber path does not, because it only rewrites a derived field
 * from freshly-read content.
 */
export async function moveCard(
  slug: string,
  id: number,
  column: string,
  index: number,
  expectedMtimeMs?: number,
): Promise<MoveResult> {
  assertSlug(slug);
  const root = vaultRoot();

  const project = await getProject(slug);
  if (!project.meta.columns.includes(column)) {
    throw new VaultError("invalid_document", `No column "${column}" in this project`);
  }

  const name = await findCardFile(root, slug, id);
  if (!name) throw new VaultError("not_found", `No card ${id} in ${slug}`);

  const file = projectPath(root, slug, CARDS_DIR, assertCardFilename(name));
  await assertUnchanged(file, expectedMtimeMs);

  const others = project.cards.filter((c) => c.column === column && c.id !== id);
  let placement = orderForIndex(others, index);
  let renumbered = false;
  let touched = 0;

  if ("renumber" in placement) {
    // The gap closed. Re-space the column, then place into the fresh gaps.
    for (const { id: otherId, order } of renumber(others)) {
      const otherName = await findCardFile(root, slug, otherId);
      if (!otherName) continue;
      await setCardOrder(root, slug, otherName, order);
      touched += 1;
    }
    renumbered = true;

    const respaced = renumber(others);
    placement = orderForIndex(respaced, index);
    if ("renumber" in placement) {
      throw new VaultError("invalid_document", "Could not find an order slot after renumbering");
    }
  }

  const raw = await readIfPresent(file);
  if (raw === null) throw new VaultError("not_found", `No card ${id} in ${slug}`);

  const data = readData(raw);
  await atomicWrite(
    file,
    replaceData(raw, { ...data, column, order: placement.order, updated: today() }),
  );
  touched += 1;

  invalidate(slug);
  return { touched, renumbered };
}

/** Rewrite a card's body. Frontmatter bytes are carried across untouched. */
export async function writeCardBody(
  slug: string,
  id: number,
  body: string,
  expectedMtimeMs?: number,
): Promise<{ mtimeMs: number }> {
  assertSlug(slug);
  const root = vaultRoot();

  const name = await findCardFile(root, slug, id);
  if (!name) throw new VaultError("not_found", `No card ${id} in ${slug}`);

  const file = projectPath(root, slug, CARDS_DIR, assertCardFilename(name));
  const raw = await readIfPresent(file);
  if (raw === null) throw new VaultError("not_found", `No card ${id} in ${slug}`);

  await assertUnchanged(file, expectedMtimeMs);

  const mtimeMs = await atomicWrite(file, replaceBody(raw, body));
  invalidate(slug);
  return { mtimeMs };
}

export type CardMetaPatch = Partial<
  Pick<CardMeta, "title" | "priority" | "size" | "confidence" | "blocked" | "phase">
>;

/** Rewrite a card's frontmatter. Body bytes are carried across untouched. */
export async function patchCardMeta(
  slug: string,
  id: number,
  patch: CardMetaPatch,
  expectedMtimeMs?: number,
): Promise<{ mtimeMs: number; meta: CardMeta }> {
  assertSlug(slug);
  const root = vaultRoot();

  const name = await findCardFile(root, slug, id);
  if (!name) throw new VaultError("not_found", `No card ${id} in ${slug}`);

  const file = projectPath(root, slug, CARDS_DIR, assertCardFilename(name));
  const raw = await readIfPresent(file);
  if (raw === null) throw new VaultError("not_found", `No card ${id} in ${slug}`);

  await assertUnchanged(file, expectedMtimeMs);

  const current = CardMetaSchema.safeParse(readData(raw));
  if (!current.success) {
    throw new VaultError("invalid_document", `${name}: ${describeIssues(current.error)}`);
  }

  const next = CardMetaSchema.safeParse({ ...current.data, ...patch, id, updated: today() });
  if (!next.success) {
    throw new VaultError("invalid_document", describeIssues(next.error));
  }

  const known = new Set(Object.keys(CardMetaSchema.shape));
  const carried = Object.entries(readData(raw)).filter(([k]) => !known.has(k));
  const out: Record<string, unknown> = { ...next.data };
  for (const [k, v] of carried) out[k] = v;

  // Same preservation rule as patchProjectMeta; the reasoning is documented there.
  const mtimeMs = await atomicWrite(file, replaceData(raw, out));
  invalidate(slug);
  return { mtimeMs, meta: next.data };
}

/**
 * Replace the project's column list: add, reorder, or remove.
 *
 * Removing a column that still holds cards is refused rather than orphaning them. The
 * board can render an orphan (there is a notice for it), but silently creating one from
 * a UI action would be losing the user's work in a way that looks like it worked.
 */
export async function setColumns(
  slug: string,
  columns: string[],
  expectedMtimeMs?: number,
): Promise<{ mtimeMs: number; columns: string[] }> {
  assertSlug(slug);

  const trimmed = columns.map((c) => c.trim()).filter(Boolean);
  if (trimmed.length === 0) {
    throw new VaultError("invalid_document", "A project needs at least one column");
  }

  const seen = new Set<string>();
  for (const c of trimmed) {
    const key = c.toLowerCase();
    if (seen.has(key)) {
      throw new VaultError("already_exists", `Duplicate column: ${c}`);
    }
    seen.add(key);
  }

  const project = await getProject(slug);
  const removed = project.meta.columns.filter((c) => !trimmed.includes(c));

  for (const column of removed) {
    const held = project.cards.filter((c) => c.column === column);
    if (held.length > 0) {
      throw new VaultError(
        "conflict",
        `"${column}" still holds ${held.length} card${held.length === 1 ? "" : "s"}. ` +
          `Move them before removing it.`,
      );
    }
  }

  const { mtimeMs, meta } = await patchProjectMeta(slug, { columns: trimmed }, expectedMtimeMs);
  return { mtimeMs, columns: meta.columns };
}

/**
 * Rename a column across the project in one pass.
 *
 * Cards carry the column name, so a rename that touched only `project.md` would orphan
 * every card in that column.
 */
/**
 * Rename a column and rewrite every card that referenced it.
 *
 * `expectedMtimeMs` guards project.md, which is what this function decides the new column
 * list from. It used to carry no precondition at all, on the reasoning that a rename
 * rewrites many card files and so cannot be pinned to one mtime. That conflated two
 * different writes: the CARDS are each re-read immediately before being rewritten, so they
 * genuinely need no precondition - but project.md is written from the list read at the top
 * of this function, and without a check a rename silently overwrote any column change made
 * since the caller last looked.
 *
 * The cards are still best-effort by design. Failing halfway would leave the column list
 * renamed and some cards pointing at a name that no longer exists, so the precondition
 * guards the decision, not the sweep.
 */
export async function renameColumn(
  slug: string,
  from: string,
  to: string,
  expectedMtimeMs?: number,
): Promise<number> {
  assertSlug(slug);
  const root = vaultRoot();

  const project = await getProject(slug);
  if (!project.meta.columns.includes(from)) {
    throw new VaultError("not_found", `No column "${from}"`);
  }
  if (from !== to && project.meta.columns.includes(to)) {
    throw new VaultError("already_exists", `A column called "${to}" already exists`);
  }

  await patchProjectMeta(
    slug,
    { columns: project.meta.columns.map((c) => (c === from ? to : c)) },
    expectedMtimeMs,
  );

  let moved = 0;
  for (const card of project.cards.filter((c) => c.column === from)) {
    const name = await findCardFile(root, slug, card.id);
    if (!name) continue;
    const file = projectPath(root, slug, CARDS_DIR, assertCardFilename(name));
    const raw = await readIfPresent(file);
    if (raw === null) continue;
    await atomicWrite(file, replaceData(raw, { ...readData(raw), column: to }));
    moved += 1;
  }

  invalidate(slug);
  return moved;
}

// ---------------------------------------------------------------- aux documents

export type AuxFile = "roadmap.md" | "questions.md" | "risks.md";

/** Frontmatter of one of the project's structured side documents. */
export async function readAux(slug: string, file: AuxFile): Promise<Record<string, unknown>> {
  assertSlug(slug);
  const raw = await readIfPresent(projectPath(vaultRoot(), slug, file));
  return raw === null ? {} : readData(raw);
}

/** The write precondition for a side document. */
export async function auxMtime(slug: string, file: AuxFile): Promise<number> {
  assertSlug(slug);
  return mtimeOf(projectPath(vaultRoot(), slug, file));
}

/** Rewrite the frontmatter of a side document, carrying its body across untouched. */
export async function writeAuxData(
  slug: string,
  file: AuxFile,
  data: Record<string, unknown>,
  expectedMtimeMs?: number,
): Promise<{ mtimeMs: number }> {
  assertSlug(slug);
  const target = projectPath(vaultRoot(), slug, file);
  await assertUnchanged(target, expectedMtimeMs);

  const raw = await readIfPresent(target);
  const mtimeMs = await atomicWrite(
    target,
    raw === null ? buildDoc(data, "") : replaceData(raw, data),
  );
  invalidate(slug);
  return { mtimeMs };
}

/**
 * Answer an open question, or reopen an answered one.
 *
 * Answers are the mechanism by which the plan improves: every later run is given the
 * answered questions as confirmed facts, so the model has more truth to work from rather
 * than a better guess. Reopening is allowed because an answer can turn out to be wrong.
 */
export async function setQuestionAnswer(
  slug: string,
  id: string,
  answer: string | null,
  expectedMtimeMs?: number,
): Promise<{ mtimeMs: number; question: Question }> {
  assertSlug(slug);

  const data = await readAux(slug, QUESTIONS_FILE);
  const parsed = QuestionsSchema.safeParse(data);
  if (!parsed.success) {
    throw new VaultError("invalid_document", `${QUESTIONS_FILE}: ${describeIssues(parsed.error)}`);
  }

  const index = parsed.data.questions.findIndex((q) => q.id === id);
  if (index === -1) throw new VaultError("not_found", `No question ${id} in ${slug}`);

  const trimmed = answer?.trim() ?? "";
  const existing = parsed.data.questions[index] as Question;
  const updated: Question = trimmed
    ? { ...existing, status: "answered", answer: trimmed }
    : { ...existing, status: "open", answer: null };

  const questions = [...parsed.data.questions];
  questions[index] = updated;

  const { mtimeMs } = await writeAuxData(
    slug,
    QUESTIONS_FILE,
    { ...data, questions },
    expectedMtimeMs,
  );
  return { mtimeMs, question: updated };
}

/**
 * Prepend a dated entry to the decision log.
 *
 * Prepend only, never edit. The value of a decision log is that it records what was
 * thought at the time; an entry you can revise later is just a note.
 */
export async function prependLog(slug: string, entry: string): Promise<{ mtimeMs: number }> {
  assertSlug(slug);
  const target = projectPath(vaultRoot(), slug, LOG_FILE);
  const existing = (await readIfPresent(target)) ?? "";
  const mtimeMs = await atomicWrite(target, `${entry.trimEnd()}\n\n${existing.trimStart()}`);
  invalidate(slug);
  return { mtimeMs };
}

/** Toggle whether an assumption has been validated. */
export async function setAssumptionValidated(
  slug: string,
  id: string,
  validated: boolean,
  expectedMtimeMs?: number,
): Promise<{ mtimeMs: number; assumption: Assumption }> {
  assertSlug(slug);

  const data = await readAux(slug, RISKS_FILE);
  const parsed = RisksSchema.safeParse(data);
  if (!parsed.success) {
    throw new VaultError("invalid_document", `${RISKS_FILE}: ${describeIssues(parsed.error)}`);
  }

  const index = parsed.data.assumptions.findIndex((a) => a.id === id);
  if (index === -1) throw new VaultError("not_found", `No assumption ${id} in ${slug}`);

  const updated: Assumption = { ...(parsed.data.assumptions[index] as Assumption), validated };
  const assumptions = [...parsed.data.assumptions];
  assumptions[index] = updated;

  const { mtimeMs } = await writeAuxData(
    slug,
    RISKS_FILE,
    { ...data, assumptions },
    expectedMtimeMs,
  );
  return { mtimeMs, assumption: updated };
}

/**
 * Create a card from supplied content.
 *
 * Distinct from `createCard`, which seeds an empty card for a person: this one takes a
 * full body and metadata from an accepted proposal. The id is still assigned here and
 * never by the caller, so a proposal cannot collide with an existing card.
 */
export async function createCardFrom(
  slug: string,
  input: {
    title: string;
    column: string;
    phase?: number | null;
    priority?: CardMeta["priority"];
    size?: CardMeta["size"];
    confidence?: number;
    body: string;
  },
): Promise<Card> {
  assertSlug(slug);
  const root = vaultRoot();

  const project = await getProject(slug);
  const column = project.meta.columns.includes(input.column)
    ? input.column
    : // Unreachable: columns is .min(1). See the note in lib/ai/apply.ts.
      (project.meta.columns[0] ?? DEFAULT_COLUMNS[0]);

  const id = await nextCardId(slug);
  const name = assertCardFilename(cardFilename(id, slugify(input.title) || `card-${id}`));
  const file = projectPath(root, slug, CARDS_DIR, name);

  const last = project.cards
    .filter((c) => c.column === column)
    .reduce((max, c) => Math.max(max, c.order), 0);

  const now = today();
  const meta: CardMeta = {
    id,
    title: input.title.trim(),
    column,
    phase: input.phase ?? null,
    priority: input.priority ?? "P2",
    size: input.size ?? "M",
    confidence: input.confidence ?? 0.5,
    blocked: false,
    order: last + ORDER_STEP,
    created: now,
    updated: now,
  };

  await atomicWrite(file, buildDoc(meta as unknown as Record<string, unknown>, input.body));
  invalidate(slug);
  return { ...meta, body: input.body, file: name, mtimeMs: await mtimeOf(file) };
}

/** Relative path of a card file, for snapshot manifests. */
export async function cardRelPath(slug: string, id: number): Promise<string | null> {
  assertSlug(slug);
  const name = await findCardFile(vaultRoot(), slug, id);
  return name ? `${CARDS_DIR}/${name}` : null;
}

// ---------------------------------------------------------------- snapshots

const SNAPSHOTS_DIR = ".snapshots";

export interface SnapshotManifest {
  runId: string;
  createdAt: string;
  /** Existing files copied into the snapshot. Restored verbatim on revert. */
  copied: string[];
  /** Files the apply created. They have no counterpart, so revert trashes them. */
  created: string[];
}

/**
 * Copy the files an apply is about to touch.
 *
 * The manifest is what makes revert possible at all: without a record of which files
 * were *created*, revert could not tell them apart from files that always existed, and
 * would leave the created ones behind.
 */
export async function createSnapshot(
  slug: string,
  runId: string,
  copied: string[],
): Promise<string> {
  assertSlug(slug);
  const root = vaultRoot();
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = projectPath(root, slug, SNAPSHOTS_DIR, id);
  await fsp.mkdir(dir, { recursive: true });

  const actuallyCopied: string[] = [];
  for (const rel of copied) {
    const from = projectPath(root, slug, ...rel.split("/"));
    const raw = await readIfPresent(from);
    if (raw === null) continue; // not there yet; it will be a "created" instead

    const to = path.join(dir, ...rel.split("/"));
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.writeFile(to, raw, "utf8");
    actuallyCopied.push(rel);
  }

  const manifest: SnapshotManifest = {
    runId,
    createdAt: new Date().toISOString(),
    copied: actuallyCopied,
    created: [],
  };
  await fsp.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return id;
}

/**
 * Record which files the apply created.
 *
 * Written after the fact because a created card's filename is only known once the vault
 * has assigned its id. A crash between the writes would leave those files out of the
 * manifest and therefore un-reverted — visible, recoverable by hand, and preferable to
 * reserving ids up front and leaking them on failure.
 */
export async function finalizeSnapshot(
  slug: string,
  snapshotId: string,
  created: string[],
): Promise<void> {
  assertSlug(slug);
  const file = projectPath(vaultRoot(), slug, SNAPSHOTS_DIR, snapshotId, "manifest.json");
  const raw = await readIfPresent(file);
  if (raw === null) return;

  try {
    const manifest = JSON.parse(raw) as SnapshotManifest;
    manifest.created = created;
    await fsp.writeFile(file, JSON.stringify(manifest, null, 2), "utf8");
  } catch {
    /* an unreadable manifest is reported by revert, not repaired here */
  }
}

export interface SnapshotInfo {
  id: string;
  manifest: SnapshotManifest;
}

export async function listSnapshots(slug: string): Promise<SnapshotInfo[]> {
  assertSlug(slug);
  const root = vaultRoot();
  let ids: string[];
  try {
    ids = await fsp.readdir(projectPath(root, slug, SNAPSHOTS_DIR));
  } catch {
    return [];
  }

  const out: SnapshotInfo[] = [];
  for (const id of ids.sort().reverse()) {
    const raw = await readIfPresent(projectPath(root, slug, SNAPSHOTS_DIR, id, "manifest.json"));
    if (raw === null) continue;
    try {
      out.push({ id, manifest: JSON.parse(raw) as SnapshotManifest });
    } catch {
      continue;
    }
  }
  return out;
}

export interface RestoreResult {
  restored: number;
  trashed: number;
  snapshotId: string;
  runId: string;
}

/**
 * Undo the newest apply: copied files go back over their originals, created files move
 * to `.trash/`. Snapshots are never pruned — deleting somebody's undo history to save
 * a few kilobytes is a bad trade.
 */
export async function restoreLatestSnapshot(slug: string): Promise<RestoreResult> {
  assertSlug(slug);
  const root = vaultRoot();

  const [latest] = await listSnapshots(slug);
  if (!latest) throw new VaultError("not_found", "There is no snapshot to revert to");

  let restored = 0;
  for (const rel of latest.manifest.copied) {
    const from = projectPath(root, slug, SNAPSHOTS_DIR, latest.id, ...rel.split("/"));
    const raw = await readIfPresent(from);
    if (raw === null) continue;
    await atomicWrite(projectPath(root, slug, ...rel.split("/")), raw);
    restored += 1;
  }

  let trashed = 0;
  for (const rel of latest.manifest.created) {
    const target = projectPath(root, slug, ...rel.split("/"));
    const raw = await readIfPresent(target);
    if (raw === null) continue;

    const to = projectPath(root, slug, ".trash", path.basename(rel));
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(target, to);
    trashed += 1;
  }

  // Consume the snapshot so a second revert undoes the apply before it, not this one
  // again. The files stay on disk; only the manifest is retired.
  await fsp
    .rename(
      projectPath(root, slug, SNAPSHOTS_DIR, latest.id, "manifest.json"),
      projectPath(root, slug, SNAPSHOTS_DIR, latest.id, "manifest.reverted.json"),
    )
    .catch(() => undefined);

  invalidate(slug);
  return {
    restored,
    trashed,
    snapshotId: latest.id,
    runId: latest.manifest.runId,
  };
}

// ---------------------------------------------------------------- link graph

/**
 * The whole-vault link graph, cached.
 *
 * Backlinks are inherently a whole-vault question — "what points at this?" cannot be
 * answered from one project — so this reads every brief, card body and log. That makes
 * caching mandatory rather than an optimisation: without it, opening a project would
 * re-read the entire vault, and the rail already renders on every page.
 *
 * Invalidated by the same signal as the project cache, so an edit in Obsidian shows up
 * in backlinks on the next request.
 */
let graphCache: { index: IndexedProject[]; graph: LinkGraph } | null = null;

function clearGraph(): void {
  graphCache = null;
}

async function buildVaultGraph(): Promise<{ index: IndexedProject[]; graph: LinkGraph }> {
  const root = vaultRoot();
  ensureWatcher(root);

  const slugs = (await listProjectSlugs()).filter(isLegalSlug);

  const index: IndexedProject[] = [];
  const docs: LinkDoc[] = [];

  await Promise.all(
    slugs.map(async (slug) => {
      const projectDoc = await readWithMtime(projectPath(root, slug, PROJECT_FILE));
      if (!projectDoc) return;

      const meta = ProjectMetaSchema.safeParse({
        name: slug,
        ...readData(projectDoc.raw),
        slug,
      });
      if (!meta.success) return;

      // The brief is where cross-project links mostly live.
      docs.push({
        node: projectNode(slug),
        slug,
        text: split(projectDoc.raw).body,
      });

      const log = await readIfPresent(projectPath(root, slug, LOG_FILE));
      if (log) docs.push({ node: projectNode(slug), slug, text: log });

      const cards: IndexedCard[] = [];
      let names: string[] = [];
      try {
        names = await fsp.readdir(projectPath(root, slug, CARDS_DIR));
      } catch {
        /* no cards yet */
      }

      for (const name of names.filter((n) => CARD_FILE_RE.test(n)).sort()) {
        const doc = await readWithMtime(projectPath(root, slug, CARDS_DIR, name));
        if (!doc) continue;

        const parsed = CardMetaSchema.safeParse(readData(doc.raw));
        if (!parsed.success) continue;

        cards.push({
          id: parsed.data.id,
          title: parsed.data.title,
          // `0007-billing-api.md` -> `billing-api`
          fileSlug: name.slice(5, -3),
        });
        docs.push({
          node: cardNode(slug, parsed.data.id),
          slug,
          text: split(doc.raw).body,
        });
      }

      index.push({ slug, name: meta.data.name, cards });
    }),
  );

  index.sort((a, b) => a.slug.localeCompare(b.slug));
  return { index, graph: buildLinkGraph(docs, index) };
}

export async function getLinkGraph(): Promise<{ index: IndexedProject[]; graph: LinkGraph }> {
  if (graphCache) return graphCache;
  const built = await buildVaultGraph();
  if (cachingEnabled()) graphCache = built;
  return built;
}

export interface ResolvedBacklink {
  from: NodeId;
  line: string;
  /** Human-readable source: a project name, or "Project · Card title". */
  label: string;
  href: string;
}

/** Backlinks for one node, with each source resolved to a name and a link. */
export async function getBacklinks(node: NodeId): Promise<ResolvedBacklink[]> {
  const { index, graph } = await getLinkGraph();
  const incoming = graph.back.get(node) ?? [];

  return incoming.map((b) => {
    const match = /^([^/]+)(?:\/card-(\d+))?$/.exec(b.from);
    const slug = match?.[1] ?? b.from;
    const cardId = match?.[2] ? Number(match[2]) : null;

    const project = index.find((p) => p.slug === slug);
    const projectName = project?.name ?? slug;

    if (cardId === null) {
      return { from: b.from, line: b.line, label: projectName, href: `/p/${slug}/brief` };
    }

    const card = project?.cards.find((c) => c.id === cardId);
    return {
      from: b.from,
      line: b.line,
      label: `${projectName} · ${card?.title ?? `card ${cardId}`}`,
      href: `/p/${slug}/board`,
    };
  });
}

// ---------------------------------------------------------------- search

export interface SearchHit {
  slug: string;
  projectName: string;
  /** Where the match was found. */
  where: string;
  line: string;
  href: string;
}

/**
 * Plain text search across briefs, cards, logs and risks.
 *
 * Deliberately a linear scan rather than an index: the vault is tens of projects, and a
 * second index would be another thing to keep in step with the files. If this ever needs
 * to serve thousands of cards, the answer is a derived SQLite index built *from* the
 * markdown — not a change to where the truth lives.
 */
export async function searchVault(query: string, limit = 60): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const root = vaultRoot();
  const slugs = (await listProjectSlugs()).filter(isLegalSlug);
  const hits: SearchHit[] = [];

  for (const slug of slugs) {
    if (hits.length >= limit) break;

    const entry = await loadSummaryShared(root, slug);
    const projectName = entry.ok ? entry.summary.meta.name : slug;

    const scan = (text: string, where: string, href: string) => {
      for (const raw of text.split("\n")) {
        if (hits.length >= limit) return;
        const line = raw.trim();
        if (line.length === 0) continue;
        if (!line.toLowerCase().includes(needle)) continue;
        hits.push({ slug, projectName, where, line: line.slice(0, 300), href });
      }
    };

    const project = await readIfPresent(projectPath(root, slug, PROJECT_FILE));
    if (project) scan(split(project).body, "Brief", `/p/${slug}/brief`);

    const log = await readIfPresent(projectPath(root, slug, LOG_FILE));
    if (log) scan(log, "Decision log", `/p/${slug}/log`);

    const risks = await readIfPresent(projectPath(root, slug, RISKS_FILE));
    if (risks) scan(risks, "Risks", `/p/${slug}/log`);

    const questions = await readIfPresent(projectPath(root, slug, QUESTIONS_FILE));
    if (questions) scan(questions, "Questions", `/p/${slug}/questions`);

    let names: string[] = [];
    try {
      names = await fsp.readdir(projectPath(root, slug, CARDS_DIR));
    } catch {
      /* no cards */
    }
    for (const name of names.filter((n) => CARD_FILE_RE.test(n)).sort()) {
      if (hits.length >= limit) break;
      const raw = await readIfPresent(projectPath(root, slug, CARDS_DIR, name));
      if (!raw) continue;
      const parsed = CardMetaSchema.safeParse(readData(raw));
      const title = parsed.success ? parsed.data.title : name;
      scan(`${title}\n${split(raw).body}`, `Card: ${title}`, `/p/${slug}/board`);
    }
  }

  return hits;
}

export { cardFilename, slugify };

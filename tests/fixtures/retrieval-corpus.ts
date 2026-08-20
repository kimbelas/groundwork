import { chunkFile } from "@/lib/index/chunk";
import type { EvalCase } from "@/lib/index/eval";

/**
 * The retrieval evaluation corpus.
 *
 * Shared, so the unit gate and `scripts/eval-retrieval.mjs` measure the same thing. Two
 * copies of a corpus means two sets of numbers that cannot be compared, which defeats the
 * point of having numbers.
 */

export const NL = String.fromCharCode(10);

/**
 * A small corpus that looks like this codebase.
 *
 * Written rather than sampled, so each query has a knowably correct answer. The queries are
 * the kind a person actually asks — "how do we stop two writers clobbering each other"
 * rather than a keyword they already know.
 */
export const CORPUS: Record<string, string> = {
  "lib/writer.ts": [
    "/** Every write carries expectedMtimeMs. */",
    "export async function writeDocument(path: string, body: string, expectedMtimeMs: number) {",
    "  const current = await statFile(path);",
    "  if (current.mtimeMs !== expectedMtimeMs) {",
    "    throw new ConflictError('This file changed on disk.');",
    "  }",
    "  return atomicWrite(path, body);",
    "}",
  ].join(NL),

  "lib/ordering.ts": [
    "/** Card order uses sparse integers so a move rarely renumbers the column. */",
    "export const ORDER_STEP = 100;",
    "export function orderForIndex(neighbours: number[], index: number): number {",
    "  const before = neighbours[index - 1] ?? 0;",
    "  const after = neighbours[index];",
    "  if (after === undefined) return before + ORDER_STEP;",
    "  return Math.floor((before + after) / 2);",
    "}",
  ].join(NL),

  "lib/atomic.ts": [
    "/** Rename is retried on EPERM because Windows fails it while a handle is open. */",
    "export async function atomicWrite(target: string, contents: string) {",
    "  const tmp = target + '.tmp';",
    "  await writeFileRaw(tmp, contents);",
    "  for (let attempt = 0; attempt < 5; attempt += 1) {",
    "    try {",
    "      return await renameFile(tmp, target);",
    "    } catch (e) {",
    "      if (!isTransientLock(e)) throw e;",
    "    }",
    "  }",
    "}",
  ].join(NL),

  "components/Board.tsx": [
    "// Drag and drop. dnd-kit needs a stable id or it hydrates mismatched.",
    "export function Board({ columns }: { columns: Column[] }) {",
    "  return (",
    "    <DndContext id='groundwork-board' onDragEnd={handleDragEnd}>",
    "      {columns.map((c) => <ColumnView key={c.name} column={c} />)}",
    "    </DndContext>",
    "  );",
    "}",
  ].join(NL),

  "lib/theme.ts": [
    "/** Light is the default; the choice persists in a cookie so first paint is right. */",
    "export const THEME_COOKIE = 'gw.theme';",
    "export const THEMES = ['light', 'dark', 'system'] as const;",
    "export function parseTheme(value: string | undefined) {",
    "  return THEMES.includes(value as Theme) ? (value as Theme) : 'light';",
    "}",
  ].join(NL),

  "lib/snapshot.ts": [
    "/** Snapshot before every apply: copy each target file before it is touched. */",
    "export async function createSnapshot(slug: string, runId: string, files: string[]) {",
    "  const stamp = new Date().toISOString().replace(/[:.]/g, '-');",
    "  for (const file of files) {",
    "    await copyInto(snapshotDir(slug, stamp), file);",
    "  }",
    "  return stamp;",
    "}",
  ].join(NL),

  "lib/commit.ts": [
    "/** Auto-commit is bookkeeping and can never fail an apply. */",
    "export async function commitPaths(cwd: string, paths: string[], message: string) {",
    "  try {",
    "    await git(cwd, ['add', '--', ...paths]);",
    "    return { ok: true, sha: await git(cwd, ['rev-parse', 'HEAD']) };",
    "  } catch (e) {",
    "    return { ok: false, skipped: (e as Error).message };",
    "  }",
    "}",
  ].join(NL),

  "lib/grounding.ts": [
    "/** Every claim must trace to a verbatim quote, checked by string match. */",
    "export function isGrounded(claim: string, sources: string[]): boolean {",
    "  return sources.some((s) => s.includes(claim.trim()));",
    "}",
  ].join(NL),
};

/**
 * Distractors: files that share vocabulary with a target but do not answer the query.
 *
 * Without these the corpus was trivially separable - every file was topically unique, every
 * query used its exact words, and recall@1 was 100%. A saturated gate can only catch
 * catastrophic breakage; it has no room to show a tuning change making results slightly
 * worse, which is the regression that actually happens.
 *
 * Each of these deliberately overlaps: two more files talk about writing and mtime, two
 * more about ordering, two more about themes and cookies. Retrieval has to discriminate
 * rather than merely find the only file containing a word.
 *
 * Being straight about what this does and does not achieve: keyword recall on the exact-term
 * queries below is still 100%, because those queries use the same words as the code and
 * keyword matching is genuinely that good at them. The distractors stop a broken tokenizer
 * or a broken breadth score from passing, and that is their job. The queries where retrieval
 * is actually hard are in PARAPHRASES, and they are measured separately - see the note there.
 */
export const DISTRACTORS: Record<string, string> = {
  "lib/reader.ts": [
    "/** Reads a document and reports its mtime. No preconditions here. */",
    "export async function readDocument(path: string) {",
    "  const stat = await statFile(path);",
    "  return { body: await readFileRaw(path), mtimeMs: stat.mtimeMs };",
    "}",
  ].join(NL),

  "lib/writeQueue.ts": [
    "/** Serialises writes so two are never in flight against one file. */",
    "export function createWriteQueue() {",
    "  let chain: Promise<unknown> = Promise.resolve();",
    "  return (task: () => Promise<void>) => {",
    "    chain = chain.then(task, () => undefined);",
    "    return chain;",
    "  };",
    "}",
  ].join(NL),

  "lib/columns.ts": [
    "/** The column list is declared once in frontmatter; order lives on each card. */",
    "export function renameColumn(columns: string[], from: string, to: string) {",
    "  return columns.map((c) => (c === from ? to : c));",
    "}",
  ].join(NL),

  "components/CardList.tsx": [
    "// Renders cards in order. Never computes an order; the server owns that arithmetic.",
    "export function CardList({ cards }: { cards: Card[] }) {",
    "  const sorted = [...cards].sort((a, b) => a.order - b.order);",
    "  return <ul>{sorted.map((c) => <li key={c.id}>{c.title}</li>)}</ul>;",
    "}",
  ].join(NL),

  "lib/prefs.ts": [
    "/** Other preferences that also live in a cookie, none of them the theme. */",
    "export const PREFS_COOKIE = 'gw.prefs';",
    "export function parsePrefs(value: string | undefined) {",
    "  try {",
    "    return value ? JSON.parse(value) : {};",
    "  } catch {",
    "    return {};",
    "  }",
    "}",
  ].join(NL),

  "components/ThemeToggle.tsx": [
    "// Writes the theme to the document element, then the cookie, then React state.",
    "export function ThemeToggle({ current }: { current: Theme }) {",
    "  return <button onClick={() => cycle(current)}>Theme</button>;",
    "}",
  ].join(NL),

  "lib/revert.ts": [
    "/** Restores the newest snapshot. Reads the snapshot directory; writes nothing else. */",
    "export async function revertToSnapshot(slug: string, snapshotId: string) {",
    "  for (const file of await listSnapshotFiles(slug, snapshotId)) {",
    "    await copyBack(slug, snapshotId, file);",
    "  }",
    "}",
  ].join(NL),

  "lib/git-status.ts": [
    "/** Which of these paths are already dirty, so a commit message can say so. */",
    "export async function dirtyPaths(cwd: string, relPaths: string[]) {",
    "  const out = await git(cwd, ['status', '--porcelain', '--', ...relPaths]);",
    "  return splitLines(out).filter(Boolean).map((l) => l.slice(2).trim());",
    "}",
  ].join(NL),
};

export const CHUNKS = Object.entries({ ...CORPUS, ...DISTRACTORS }).flatMap(([file, text]) =>
  chunkFile(file, text),
);
export const DOCS = CHUNKS.map((c) => ({ id: c.id, text: c.text }));

/** Relevance is expressed by FILE, so a change to chunk sizing does not invalidate it. */
export function chunksOf(file: string): string[] {
  return CHUNKS.filter((c) => c.file === file).map((c) => c.id);
}

export const CASES: EvalCase[] = [
  { query: "expectedMtimeMs", relevant: chunksOf("lib/writer.ts") },
  { query: "conflict when a file changed on disk", relevant: chunksOf("lib/writer.ts") },
  { query: "sparse integer card order", relevant: chunksOf("lib/ordering.ts") },
  { query: "ORDER_STEP", relevant: chunksOf("lib/ordering.ts") },
  { query: "retry rename on EPERM", relevant: chunksOf("lib/atomic.ts") },
  { query: "atomic write temporary file", relevant: chunksOf("lib/atomic.ts") },
  { query: "dnd-kit stable id hydration", relevant: chunksOf("components/Board.tsx") },
  { query: "theme cookie light dark system", relevant: chunksOf("lib/theme.ts") },
  { query: "snapshot before apply", relevant: chunksOf("lib/snapshot.ts") },
  { query: "auto-commit never fails an apply", relevant: chunksOf("lib/commit.ts") },
  { query: "verbatim quote grounding check", relevant: chunksOf("lib/grounding.ts") },
  { query: "THEME_COOKIE", relevant: chunksOf("lib/theme.ts") },
];

/**
 * Questions asked in words the code does not use.
 *
 * These share almost no vocabulary with the file that answers them, which is exactly the
 * shape of question a person asks about a codebase they are still learning - and exactly
 * what a keyword ranker cannot do. They are not part of the keyword gate's floor, because
 * failing them is the CORRECT behaviour for keyword search; they exist to measure the gap
 * that the semantic half is there to close, and `pnpm eval:retrieval` reports both.
 */
export const PARAPHRASES: EvalCase[] = [
  {
    query: "how do we stop two people clobbering each other saving the same thing",
    relevant: chunksOf("lib/writer.ts"),
  },
  {
    query: "moving an item between positions without renumbering everything",
    relevant: chunksOf("lib/ordering.ts"),
  },
  {
    query: "why does saving sometimes need a second attempt on Windows",
    relevant: chunksOf("lib/atomic.ts"),
  },
  {
    query: "keeping a copy of the old version before changing anything",
    relevant: chunksOf("lib/snapshot.ts"),
  },
  {
    query: "making sure the model did not invent something that is not in the source",
    relevant: chunksOf("lib/grounding.ts"),
  },
];


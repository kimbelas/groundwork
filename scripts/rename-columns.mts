/**
 * One-off: rename the vault's board columns to the words the app now ships with.
 *
 * Run: `pnpm tsx scripts/rename-columns.mts` (add `--dry` to see the plan and change nothing)
 *
 * ## Why a script and not a migration
 *
 * The vault is a folder of markdown, not a database, and it has no schema version to step
 * forward. This is a rename someone would otherwise do by hand across three projects and
 * four cards — which is exactly the sort of thing that leaves one card pointing at a column
 * that no longer exists.
 *
 * It goes through `renameColumn` rather than editing frontmatter directly, because that
 * function does the part a find-and-replace would miss: a card carries its own `column`
 * name, so renaming only `project.md` orphans every card in that column. Card membership
 * and the column list are one fact stored in two places, and one function owns keeping
 * them agreed.
 *
 * Kept in the repository rather than deleted after use. It documents which words replaced
 * which, and anyone forking this with an older vault needs to run it too.
 */

import { getProject, listProjects, renameColumn } from "../lib/vault.ts";

/**
 * Old to new, in order.
 *
 * "Intake" and "Shaping" are the words the redesign set out to remove: they are this app's
 * private vocabulary, and nobody arriving from Jira, Notion or ClickUp has to be told what
 * "To do" means. `Done` is unchanged and absent from this list.
 */
const RENAMES: [from: string, to: string][] = [
  ["Intake", "Backlog"],
  ["Shaping", "To do"],
  ["Build", "In progress"],
  ["Review", "In review"],
];

const dry = process.argv.includes("--dry");

const projects = await listProjects();
let renamed = 0;
let cardsMoved = 0;

for (const entry of projects) {
  if (!entry.ok) {
    console.log(`skip ${entry.slug}: not readable`);
    continue;
  }

  for (const [from, to] of RENAMES) {
    /*
     * Re-read before each rename.
     *
     * `renameColumn` takes an `expectedMtimeMs` guarding project.md, and every rename in
     * this loop writes that file — so a baseline captured once at the top would be stale
     * by the second rename and 409. Reading per step is what makes four sequential renames
     * against one file work at all.
     */
    const project = await getProject(entry.slug);
    if (!project.meta.columns.includes(from)) continue;

    if (project.meta.columns.includes(to)) {
      // Renaming onto an existing column would silently merge two columns' cards.
      console.log(`skip ${entry.slug}: "${to}" already exists alongside "${from}"`);
      continue;
    }

    if (dry) {
      console.log(`would rename ${entry.slug}: "${from}" -> "${to}"`);
      renamed += 1;
      continue;
    }

    const moved = await renameColumn(entry.slug, from, to, project.mtimeMs);
    renamed += 1;
    cardsMoved += moved;
    console.log(`${entry.slug}: "${from}" -> "${to}" (${moved} card${moved === 1 ? "" : "s"})`);
  }
}

console.log(
  `\n${dry ? "Would rename" : "Renamed"} ${renamed} column${renamed === 1 ? "" : "s"}` +
    (dry ? "" : `, rewriting ${cardsMoved} card${cardsMoved === 1 ? "" : "s"}`),
);

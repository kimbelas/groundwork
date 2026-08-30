import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting a project, against a throwaway vault.
 *
 * The headline guarantee is that the word "delete" never means "unlink": every case below
 * ends with the files still readable somewhere. The second guarantee is that a refused
 * delete refuses *completely* - a project that fails the precondition is still a project,
 * not a half-moved directory.
 */

let dir: string;
let vault: typeof import("@/lib/vault");

function projectDoc(slug: string, name: string): string {
  return `---
name: ${name}
slug: ${slug}
stage: shaping
health: green
archetype: client
columns: [Intake, Shaping, Done]
created: 2026-08-01
updated: 2026-08-01
---

A brief worth not losing.
`;
}

const LOG_DOC = `# Log

- Something decided.
`;

const CARD_DOC = `---
id: 1
title: First
---

Body.
`;

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, contents, "utf8");
}

async function exists(rel: string): Promise<boolean> {
  return fsp
    .stat(path.join(dir, rel))
    .then(() => true)
    .catch(() => false);
}

async function trashedDirs(): Promise<string[]> {
  return fsp.readdir(path.join(dir, ".trash")).catch(() => [] as string[]);
}

async function mtimeOfProject(slug: string): Promise<number> {
  const st = await fsp.stat(path.join(dir, slug, "project.md"));
  return st.mtimeMs;
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-trash-"));
  process.env.GROUNDWORK_VAULT = dir;
  vi.resetModules();
  vault = await import("@/lib/vault");

  await write("alpha/project.md", projectDoc("alpha", "Alpha"));
  await write("alpha/log.md", LOG_DOC);
  await write("alpha/cards/0001-first.md", CARD_DOC);
  await write("beta/project.md", projectDoc("beta", "Beta"));
});

afterEach(async () => {
  delete process.env.GROUNDWORK_VAULT;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("trashProject", () => {
  it("moves the folder into .trash instead of deleting it", async () => {
    const mtime = await mtimeOfProject("alpha");
    const { trashedTo } = await vault.trashProject("alpha", mtime);

    expect(await exists("alpha")).toBe(false);
    expect(trashedTo.startsWith(".trash/alpha-")).toBe(true);

    // Every file, not just project.md. A card and the decision log are the two that would
    // hurt most to lose, so they are the two asserted.
    const moved = path.join(dir, trashedTo);
    expect(await fsp.readFile(path.join(moved, "project.md"), "utf8")).toContain("Alpha");
    expect(await fsp.readFile(path.join(moved, "log.md"), "utf8")).toContain("Something decided");
    expect(
      await fsp.readFile(path.join(moved, "cards", "0001-first.md"), "utf8"),
    ).toContain("First");
  });

  it("takes the project out of the listing without touching its neighbour", async () => {
    await vault.trashProject("alpha", await mtimeOfProject("alpha"));

    // `.trash` starts with a dot, so the existing dot-prefix filter is what hides it. This
    // asserts that rule still holds rather than assuming it.
    expect(await vault.listProjectSlugs()).toEqual(["beta"]);
  });

  it("refuses a stale precondition and leaves the project exactly where it was", async () => {
    const stale = await mtimeOfProject("alpha");
    await write("alpha/project.md", projectDoc("alpha", "Alpha renamed elsewhere"));

    await expect(vault.trashProject("alpha", stale)).rejects.toMatchObject({
      code: "conflict",
    });

    // The refusal has to be total. A half-moved directory would be worse than either outcome.
    expect(await exists("alpha/project.md")).toBe(true);
    expect(await exists("alpha/cards/0001-first.md")).toBe(true);
    expect(await trashedDirs()).toEqual([]);
  });

  it("reports a missing project as not_found, never as a conflict", async () => {
    /*
     * The bug this pins: `mtimeOf` returns 0 for a file that is not there, so checking the
     * precondition first would answer "this changed on disk" for a project that does not
     * exist. Right refusal, wrong reason, and the wrong reason sends someone hunting for a
     * lost update that never happened.
     */
    await expect(vault.trashProject("nonexistent", 12345)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("rejects a slug that tries to escape the vault", async () => {
    await expect(vault.trashProject("../../etc", 1)).rejects.toMatchObject({
      code: "invalid_slug",
    });
  });

  it("keeps two removals of the same slug apart", async () => {
    await vault.trashProject("alpha", await mtimeOfProject("alpha"));

    // Recreate under the same name, then remove it again. Without the timestamp the second
    // rename would collide with the first - silently merging on POSIX, EPERM on Windows.
    await write("alpha/project.md", projectDoc("alpha", "Alpha the second"));
    await vault.trashProject("alpha", await mtimeOfProject("alpha"));

    const trashed = await trashedDirs();
    expect(trashed).toHaveLength(2);

    const names = await Promise.all(
      trashed.map(async (d) =>
        fsp.readFile(path.join(dir, ".trash", d, "project.md"), "utf8"),
      ),
    );
    expect(names.some((t) => /^name: Alpha$/m.test(t))).toBe(true);
    expect(names.some((t) => t.includes("Alpha the second"))).toBe(true);
  });
});

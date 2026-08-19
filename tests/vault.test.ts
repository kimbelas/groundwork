import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readData, split } from "@/lib/frontmatter";
import { DEFAULT_COLUMNS } from "@/lib/schema";

/**
 * Test 5 of the five: a write carrying a stale mtime must 409 and leave the file
 * untouched. Also covers the graceful-degradation contract — one malformed file is one
 * malformed file, never a dead dashboard.
 *
 * The vault module reads GROUNDWORK_VAULT at call time, so each test gets a throwaway
 * directory and the developer's real vault is never touched.
 */

let dir: string;
let vault: typeof import("@/lib/vault");

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, contents, "utf8");
}

const PROJECT = `---
name: Portal Rebuild
slug: portal-rebuild
stage: shaping
health: amber
archetype: client
columns: [Intake, Shaping, Done]
created: 2026-08-04
updated: 2026-08-17
---

Original brief body.
`;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-vault-"));
  process.env.GROUNDWORK_VAULT = dir;
  // Re-import per test so the module-level index cache and fs watcher start clean.
  vi.resetModules();
  vault = await import("@/lib/vault");
  await write("portal-rebuild/project.md", PROJECT);
});

afterEach(async () => {
  delete process.env.GROUNDWORK_VAULT;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("reads", () => {
  it("loads a project written by hand", async () => {
    const project = await vault.getProject("portal-rebuild");
    expect(project.meta.name).toBe("Portal Rebuild");
    expect(project.meta.stage).toBe("shaping");
    expect(project.meta.columns).toEqual(["Intake", "Shaping", "Done"]);
    expect(project.brief.trim()).toBe("Original brief body.");
    expect(project.briefEmpty).toBe(false);
  });

  it("fills defaults for a minimal hand-written project", async () => {
    await write("sparse/project.md", "---\nname: Sparse\n---\n");
    const project = await vault.getProject("sparse");
    expect(project.meta.stage).toBe("idea");
    expect(project.meta.health).toBe("green");
    expect(project.meta.columns.length).toBeGreaterThan(0);
    expect(project.briefEmpty).toBe(true);
  });

  it("treats the folder name as authoritative for slug", async () => {
    await write("real-slug/project.md", "---\nname: X\nslug: lying-slug\n---\n");
    const project = await vault.getProject("real-slug");
    expect(project.meta.slug).toBe("real-slug");
  });

  it("reports an unreadable project instead of throwing", async () => {
    await write("broken/project.md", "---\nname: 42\nstage: nonsense\n---\n");
    const entries = await vault.listProjects();
    const broken = entries.find((e) => e.slug === "broken");
    expect(broken?.ok).toBe(false);
    // The healthy project still loads.
    expect(entries.find((e) => e.slug === "portal-rebuild")?.ok).toBe(true);
  });

  it("keeps one malformed card from taking down the board", async () => {
    await write(
      "portal-rebuild/cards/0001-good.md",
      "---\nid: 1\ntitle: Good\ncolumn: Intake\n---\nbody\n",
    );
    await write("portal-rebuild/cards/0002-bad.md", "---\nid: not-a-number\n---\nbody\n");

    const project = await vault.getProject("portal-rebuild");
    expect(project.cards).toHaveLength(1);
    expect(project.cards[0]?.title).toBe("Good");
    expect(project.warnings.join(" ")).toContain("0002-bad.md");
  });

  it("ignores dotfolders so snapshots and trash never render as content", async () => {
    await write("portal-rebuild/.snapshots/2026-01-01/project.md", PROJECT);
    await write("portal-rebuild/.trash/0009-gone.md", "---\nid: 9\ntitle: Gone\ncolumn: Intake\n---\n");
    const project = await vault.getProject("portal-rebuild");
    expect(project.cards).toHaveLength(0);
  });

  it("rejects a traversal slug at the read boundary", async () => {
    // Asserted by code, not instanceof: vi.resetModules() gives the re-imported vault
    // its own copy of lib/errors, so the class identity differs from the one imported
    // statically at the top of this file.
    await expect(vault.getProject("../outside")).rejects.toMatchObject({
      code: "invalid_slug",
    });
  });
});

describe("writeBrief", () => {
  it("replaces the body and leaves frontmatter byte-identical", async () => {
    const before = split(PROJECT).head;
    const { mtimeMs } = await vault.writeBrief("portal-rebuild", "\nA new brief.\n");

    const raw = await fsp.readFile(path.join(dir, "portal-rebuild/project.md"), "utf8");
    expect(split(raw).head).toBe(before);
    expect(split(raw).body).toBe("\nA new brief.\n");
    expect(mtimeMs).toBeGreaterThan(0);
  });

  it("409s on a stale mtime and leaves the file untouched", async () => {
    const file = path.join(dir, "portal-rebuild/project.md");
    const original = await fsp.readFile(file, "utf8");

    await expect(vault.writeBrief("portal-rebuild", "clobbered", 1)).rejects.toMatchObject({
      code: "conflict",
    });

    expect(await fsp.readFile(file, "utf8")).toBe(original);
  });

  it("accepts the mtime it was given", async () => {
    const project = await vault.getProject("portal-rebuild");
    await expect(
      vault.writeBrief("portal-rebuild", "\nfresh\n", project.mtimeMs),
    ).resolves.toBeTruthy();
  });
});

describe("patchProjectMeta", () => {
  it("replaces frontmatter and leaves the body byte-identical", async () => {
    const before = split(PROJECT).body;
    await vault.patchProjectMeta("portal-rebuild", { stage: "building" });

    const raw = await fsp.readFile(path.join(dir, "portal-rebuild/project.md"), "utf8");
    expect(split(raw).body).toBe(before);
    expect(readData(raw).stage).toBe("building");
  });

  it("stamps updated", async () => {
    await vault.patchProjectMeta("portal-rebuild", { health: "red" });
    const raw = await fsp.readFile(path.join(dir, "portal-rebuild/project.md"), "utf8");
    const data = readData(raw);
    const updated = data.updated instanceof Date ? data.updated.toISOString().slice(0, 10) : data.updated;
    expect(updated).toBe(new Date().toISOString().slice(0, 10));
  });

  it("409s on a stale mtime", async () => {
    await expect(
      vault.patchProjectMeta("portal-rebuild", { stage: "shipped" }, 1),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("createProject", () => {
  it("scaffolds a project indistinguishable from a hand-written one", async () => {
    const meta = await vault.createProject({ name: "Translator Rates", archetype: "saas-mvp" });
    expect(meta.slug).toBe("translator-rates");

    const project = await vault.getProject("translator-rates");
    expect(project.meta.archetype).toBe("saas-mvp");
    expect(project.briefEmpty).toBe(true);

    for (const f of ["project.md", "roadmap.md", "questions.md", "risks.md", "log.md"]) {
      await expect(fsp.access(path.join(dir, "translator-rates", f))).resolves.toBeUndefined();
    }
  });

  it("starts a new project on the default columns", async () => {
    const meta = await vault.createProject({ name: "Column Defaults" });
    const project = await vault.getProject(meta.slug);

    expect(project.meta.columns).toEqual([...DEFAULT_COLUMNS]);
    // Ordinary words, and none of them colliding with a stage or a phase name — "Shaping"
    // used to be all three at once.
    expect(project.meta.columns).toContain("Backlog");
    expect(project.meta.columns).toContain("In progress");
    expect(project.meta.columns).not.toContain("Shaping");
  });

  it("does not force those columns on a project that already has its own", async () => {
    // Columns are per-project data, so the default is a starting point and nothing more.
    // The e2e fixtures rely on this: they use names of their own, which is what proves
    // no part of the app has quietly hard-coded the defaults.
    const project = await vault.getProject("portal-rebuild");
    expect(project.meta.columns).not.toEqual([...DEFAULT_COLUMNS]);
    expect(project.meta.columns.length).toBeGreaterThan(0);
  });

  it("refuses to overwrite an existing project", async () => {
    await expect(vault.createProject({ name: "Portal Rebuild" })).rejects.toMatchObject({
      code: "already_exists",
    });
  });
});

describe("nextCardId", () => {
  it("starts at 1 and never reuses a trashed id", async () => {
    expect(await vault.nextCardId("portal-rebuild")).toBe(1);

    await write("portal-rebuild/cards/0003-a.md", "---\nid: 3\ntitle: A\ncolumn: Intake\n---\n");
    await write("portal-rebuild/.trash/0009-gone.md", "---\nid: 9\ntitle: Gone\ncolumn: Intake\n---\n");

    expect(await vault.nextCardId("portal-rebuild")).toBe(10);
  });
});

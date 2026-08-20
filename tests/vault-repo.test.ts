import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readData } from "@/lib/frontmatter";

/**
 * Connecting a repository, at the vault layer.
 *
 * `repo` is the first *optional* field a caller may patch, and that turns out to matter
 * for two reasons beyond the feature: it is the first field that can be removed, and it
 * was the first field that would have been silently deleted by a write from a build whose
 * schema did not know about it. Both are covered here.
 */

let dir: string;
let vault: typeof import("@/lib/vault");

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, contents, "utf8");
}

async function read(rel: string): Promise<string> {
  return fsp.readFile(path.join(dir, rel), "utf8");
}

const PROJECT = `---
name: Portal Rebuild
slug: portal-rebuild
stage: shaping
health: amber
archetype: client
columns: [Backlog, To do, Done]
created: 2026-08-04
updated: 2026-08-17
---

Original brief body.
`;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-repo-"));
  process.env.GROUNDWORK_VAULT = dir;
  vi.resetModules();
  vault = await import("@/lib/vault");
  await write("portal-rebuild/project.md", PROJECT);
});

afterEach(async () => {
  delete process.env.GROUNDWORK_VAULT;
  await fsp.rm(dir, { recursive: true, force: true });
});

const REPO = process.platform === "win32" ? "C:\\work\\portal" : "/work/portal";

describe("patchProjectMeta and the repo field", () => {
  it("stores a connected repo and reads it back", async () => {
    const { meta } = await vault.patchProjectMeta("portal-rebuild", { repo: REPO });
    expect(meta.repo).toBe(REPO);

    const reloaded = await vault.getProject("portal-rebuild");
    expect(reloaded.meta.repo).toBe(REPO);
  });

  it("writes the field into the file, not only the returned object", async () => {
    await vault.patchProjectMeta("portal-rebuild", { repo: REPO });
    expect(readData(await read("portal-rebuild/project.md")).repo).toBe(REPO);
  });

  it("leaves the brief body byte-identical", async () => {
    const before = await read("portal-rebuild/project.md");
    await vault.patchProjectMeta("portal-rebuild", { repo: REPO });
    const after = await read("portal-rebuild/project.md");

    // A frontmatter edit must not touch the body. Same contract every other write has.
    expect(after.split("---\n").at(-1)).toBe(before.split("---\n").at(-1));
  });

  it("removes the field when passed null", async () => {
    await vault.patchProjectMeta("portal-rebuild", { repo: REPO });
    const { meta } = await vault.patchProjectMeta("portal-rebuild", { repo: null });

    expect(meta.repo).toBeUndefined();
    // The key is gone, not present-and-empty. A bare `repo:` line parses back as null and
    // reads like a broken setting rather than an absent one.
    expect("repo" in readData(await read("portal-rebuild/project.md"))).toBe(false);
  });

  it("leaves a connected repo alone when the patch does not mention it", async () => {
    await vault.patchProjectMeta("portal-rebuild", { repo: REPO });
    const { meta } = await vault.patchProjectMeta("portal-rebuild", { stage: "building" });

    expect(meta.stage).toBe("building");
    expect(meta.repo).toBe(REPO);
  });

  it("treats an explicit undefined as 'not provided', never as 'clear it'", async () => {
    await vault.patchProjectMeta("portal-rebuild", { repo: REPO });

    // A caller building a patch programmatically - `{ [key]: value }` where value happens
    // to be undefined - must not wipe the field. Only null does that.
    const { meta } = await vault.patchProjectMeta("portal-rebuild", { repo: undefined });
    expect(meta.repo).toBe(REPO);
  });

  it("does not throw a YAML error when a patch carries an undefined value", async () => {
    /*
     * The regression this guards: YAML has no representation for undefined, and js-yaml
     * throws `unacceptable kind of an object to dump` rather than skipping the key. That
     * surfaced as a 500 with no usable message. Unreachable before `repo`, because every
     * patchable field was required or had a default.
     */
    await expect(
      vault.patchProjectMeta("portal-rebuild", { repo: undefined, stage: "building" }),
    ).resolves.toBeDefined();
  });

  it("disconnecting a repo that was never connected is not an error", async () => {
    const { meta } = await vault.patchProjectMeta("portal-rebuild", { repo: null });
    expect(meta.repo).toBeUndefined();
  });

  it("still honours the mtime precondition", async () => {
    // The repo field is an ordinary frontmatter edit and gets the same guard as the rest.
    const project = await vault.getProject("portal-rebuild");
    await vault.patchProjectMeta("portal-rebuild", { stage: "building" }, project.mtimeMs);

    /*
     * Read `.code` rather than using `isVaultError`.
     *
     * `vi.resetModules()` plus a dynamic import gives the vault module its own copy of
     * `lib/errors`, so its VaultError is a different class from the one a static import
     * here would see and `instanceof` is false for a perfectly good error. The typed code
     * is the part the route layer branches on anyway.
     */
    let code = "did-not-throw";
    try {
      await vault.patchProjectMeta("portal-rebuild", { repo: REPO }, project.mtimeMs);
    } catch (e) {
      code = (e as { code?: string }).code ?? String(e);
    }
    expect(code).toBe("conflict");
  });

  it("keeps a hand-written repo path that the app never set", async () => {
    // The vault is editable in Obsidian. A path typed there must survive a read.
    await write(
      "typed-by-hand/project.md",
      `---\nname: Hand\nrepo: ${REPO}\n---\n\nBody.\n`,
    );
    const project = await vault.getProject("typed-by-hand");
    expect(project.meta.repo).toBe(REPO);
  });
});

describe("frontmatter the app does not manage", () => {
  const WITH_EXTRAS = `---
name: Extras
tags: [portal, q3]
aliases: [Old Portal]
obsidian-plugin-field: 7
---

Body.
`;

  it("survives a project meta write", async () => {
    /*
     * A zod object strips unknown keys, so writing the parsed result straight back used to
     * delete every hand-added field. This is the bug that made adding `repo` to the schema
     * a prerequisite rather than a detail: without it, a write from an older build erases
     * the connection - and, more importantly, erases a user's own notes-adjacent metadata.
     */
    await write("extras/project.md", WITH_EXTRAS);
    await vault.patchProjectMeta("extras", { stage: "building" });

    const data = readData(await read("extras/project.md"));
    expect(data.tags).toEqual(["portal", "q3"]);
    expect(data.aliases).toEqual(["Old Portal"]);
    expect(data["obsidian-plugin-field"]).toBe(7);
    expect(data.stage).toBe("building");
  });

  it("survives a card meta write", async () => {
    await write(
      "extras/cards/0001-a-card.md",
      `---\nid: 1\ntitle: A card\ncolumn: Backlog\nmy-own-field: keep me\n---\n\nBody.\n`,
    );
    await write("extras/project.md", WITH_EXTRAS);

    await vault.patchCardMeta("extras", 1, { title: "Renamed" });

    const data = readData(await read("extras/cards/0001-a-card.md"));
    expect(data["my-own-field"]).toBe("keep me");
    expect(data.title).toBe("Renamed");
  });

  it("does not resurrect a field the write deliberately removed", async () => {
    // The preservation pass reads the original file, so a naive merge would put `repo`
    // straight back after a disconnect. It must not: only unknown keys are carried.
    await write("extras/project.md", `---\nname: Extras\nrepo: ${REPO}\ntags: [x]\n---\n\nB.\n`);
    await vault.patchProjectMeta("extras", { repo: null });

    const data = readData(await read("extras/project.md"));
    expect("repo" in data).toBe(false);
    expect(data.tags).toEqual(["x"]);
  });
});

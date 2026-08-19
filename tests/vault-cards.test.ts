import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readData, split } from "@/lib/frontmatter";

/**
 * Card operations against a throwaway vault.
 *
 * The headline guarantee is that an ordinary drag rewrites exactly one file. That is
 * what keeps "one AI apply is worth about one reviewable commit" true, and it is easy
 * to lose the moment ordering slips into dense integers.
 */

let dir: string;
let vault: typeof import("@/lib/vault");

const PROJECT = `---
name: Board Test
slug: board-test
stage: shaping
health: green
archetype: client
columns: [Intake, Shaping, Done]
created: 2026-08-01
updated: 2026-08-01
---

A brief.
`;

function cardDoc(id: number, title: string, column: string, order: number): string {
  return `---
id: ${id}
title: ${title}
column: ${column}
phase: 1
priority: P2
size: M
confidence: 0.5
blocked: false
order: ${order}
created: 2026-08-01
updated: 2026-08-01
---

Description for ${title}.

## Acceptance criteria

- [ ] First criterion
- [x] Second criterion
`;
}

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, contents, "utf8");
}

async function snapshotCards(): Promise<Map<string, string>> {
  const cards = path.join(dir, "board-test", "cards");
  const out = new Map<string, string>();
  for (const name of await fsp.readdir(cards)) {
    out.set(name, await fsp.readFile(path.join(cards, name), "utf8"));
  }
  return out;
}

function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names].filter((n) => before.get(n) !== after.get(n)).sort();
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-cards-"));
  process.env.GROUNDWORK_VAULT = dir;
  vi.resetModules();
  vault = await import("@/lib/vault");

  await write("board-test/project.md", PROJECT);
  await write("board-test/cards/0001-alpha.md", cardDoc(1, "Alpha", "Intake", 100));
  await write("board-test/cards/0002-bravo.md", cardDoc(2, "Bravo", "Intake", 200));
  await write("board-test/cards/0003-charlie.md", cardDoc(3, "Charlie", "Shaping", 100));
});

afterEach(async () => {
  delete process.env.GROUNDWORK_VAULT;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("moveCard", () => {
  it("rewrites exactly one file for an ordinary move", async () => {
    const before = await snapshotCards();
    const result = await vault.moveCard("board-test", 1, "Shaping", 1);
    const after = await snapshotCards();

    expect(result.renumbered).toBe(false);
    expect(result.touched).toBe(1);
    expect(changedFiles(before, after)).toEqual(["0001-alpha.md"]);
  });

  it("writes the new column and an order between the neighbours", async () => {
    await vault.moveCard("board-test", 1, "Shaping", 0);
    const card = await vault.getCard("board-test", 1);
    expect(card.column).toBe("Shaping");
    expect(card.order).toBeLessThan(100);
  });

  it("reorders within a column", async () => {
    await vault.moveCard("board-test", 2, "Intake", 0);
    const project = await vault.getProject("board-test");
    const intake = project.cards.filter((c) => c.column === "Intake");
    expect(intake.map((c) => c.id)).toEqual([2, 1]);
  });

  it("leaves the card body byte-identical", async () => {
    const file = path.join(dir, "board-test/cards/0001-alpha.md");
    const bodyBefore = split(await fsp.readFile(file, "utf8")).body;
    await vault.moveCard("board-test", 1, "Done", 0);
    expect(split(await fsp.readFile(file, "utf8")).body).toBe(bodyBefore);
  });

  it("renumbers the column when the gap has closed, then places the card", async () => {
    await write("board-test/cards/0004-delta.md", cardDoc(4, "Delta", "Done", 100));
    await write("board-test/cards/0005-echo.md", cardDoc(5, "Echo", "Done", 101));
    vi.resetModules();
    vault = await import("@/lib/vault");

    const result = await vault.moveCard("board-test", 1, "Done", 1);
    expect(result.renumbered).toBe(true);

    const project = await vault.getProject("board-test");
    const done = project.cards.filter((c) => c.column === "Done");
    expect(done.map((c) => c.id)).toEqual([4, 1, 5]);

    // Every order is distinct after a renumber — the whole point of the operation.
    const orders = done.map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("409s on a stale mtime without moving anything", async () => {
    await expect(vault.moveCard("board-test", 1, "Done", 0, 1)).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await vault.getCard("board-test", 1)).column).toBe("Intake");
  });

  it("rejects a column the project does not declare", async () => {
    await expect(vault.moveCard("board-test", 1, "Nowhere", 0)).rejects.toMatchObject({
      code: "invalid_document",
    });
  });

  it("rejects an unknown card", async () => {
    await expect(vault.moveCard("board-test", 999, "Done", 0)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("createCard", () => {
  it("assigns the next id and lands at the end of its column", async () => {
    const card = await vault.createCard("board-test", { title: "Delta Force", column: "Intake" });
    expect(card.id).toBe(4);
    expect(card.file).toBe("0004-delta-force.md");
    expect(card.order).toBeGreaterThan(200);

    const project = await vault.getProject("board-test");
    expect(project.cards.filter((c) => c.column === "Intake").map((c) => c.id)).toEqual([1, 2, 4]);
  });

  it("seeds an acceptance criteria section", async () => {
    const card = await vault.createCard("board-test", { title: "New", column: "Intake" });
    expect(card.body).toContain("## Acceptance criteria");
  });

  it("rejects an undeclared column", async () => {
    await expect(
      vault.createCard("board-test", { title: "X", column: "Nope" }),
    ).rejects.toMatchObject({ code: "invalid_document" });
  });
});

describe("trashCard", () => {
  it("moves the file to .trash and keeps the id reserved", async () => {
    await vault.trashCard("board-test", 2);

    await expect(fsp.access(path.join(dir, "board-test/cards/0002-bravo.md"))).rejects.toThrow();
    await expect(
      fsp.access(path.join(dir, "board-test/.trash/0002-bravo.md")),
    ).resolves.toBeUndefined();

    // 3 still exists and 2 is trashed, so the next id must clear both.
    expect(await vault.nextCardId("board-test")).toBe(4);
  });
});

describe("writeCardBody and patchCardMeta", () => {
  it("body writes leave frontmatter byte-identical", async () => {
    const file = path.join(dir, "board-test/cards/0001-alpha.md");
    const headBefore = split(await fsp.readFile(file, "utf8")).head;

    await vault.writeCardBody("board-test", 1, "\nRewritten body.\n");

    const raw = await fsp.readFile(file, "utf8");
    expect(split(raw).head).toBe(headBefore);
    expect(split(raw).body).toBe("\nRewritten body.\n");
  });

  it("meta writes leave the body byte-identical", async () => {
    const file = path.join(dir, "board-test/cards/0001-alpha.md");
    const bodyBefore = split(await fsp.readFile(file, "utf8")).body;

    await vault.patchCardMeta("board-test", 1, { priority: "P1", blocked: true });

    const raw = await fsp.readFile(file, "utf8");
    expect(split(raw).body).toBe(bodyBefore);
    expect(readData(raw).priority).toBe("P1");
    expect(readData(raw).blocked).toBe(true);
  });

  it("both honour the mtime precondition", async () => {
    await expect(vault.writeCardBody("board-test", 1, "x", 1)).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      vault.patchCardMeta("board-test", 1, { size: "L" }, 1),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects a confidence outside 0-1", async () => {
    await expect(
      vault.patchCardMeta("board-test", 1, { confidence: 5 }),
    ).rejects.toMatchObject({ code: "invalid_document" });
  });
});

describe("renameColumn", () => {
  it("renames in project.md and in every affected card", async () => {
    const moved = await vault.renameColumn("board-test", "Intake", "Triage");
    expect(moved).toBe(2);

    const project = await vault.getProject("board-test");
    expect(project.meta.columns).toEqual(["Triage", "Shaping", "Done"]);
    expect(project.cards.filter((c) => c.column === "Triage")).toHaveLength(2);
    expect(project.cards.filter((c) => c.column === "Intake")).toHaveLength(0);
  });

  it("refuses to collide with an existing column", async () => {
    await expect(vault.renameColumn("board-test", "Intake", "Done")).rejects.toMatchObject({
      code: "already_exists",
    });
  });

  it("rejects renaming a column that does not exist", async () => {
    await expect(vault.renameColumn("board-test", "Ghost", "Real")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

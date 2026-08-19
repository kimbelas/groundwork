import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The board, end to end against real files.
 *
 * Serial: every test here mutates the same fixture project, and the state is reset
 * before each so one failure cannot cascade.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "eta-board";
const ROOT = path.resolve(import.meta.dirname, "fixture-vault", SLUG);
const CARDS = path.join(ROOT, "cards");

const PROJECT = `---
name: Eta Board
slug: eta-board
stage: building
health: green
archetype: internal-tool
columns: [Intake, Shaping, Done]
created: 2026-08-01
updated: 2026-08-01
---

A board fixture with three columns.
`;

function card(id: number, title: string, column: string, priority: string, order: number): string {
  return `---
id: ${id}
title: ${title}
column: ${column}
phase: 1
priority: ${priority}
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

const FILES: Record<string, string> = {
  "0001-alpha.md": card(1, "Alpha", "Intake", "P1", 100),
  "0002-bravo.md": card(2, "Bravo", "Intake", "P2", 200),
  "0003-charlie.md": card(3, "Charlie", "Shaping", "P3", 100),
};

/**
 * Restores the fixture in place.
 *
 * Deliberately does NOT delete the cards directory: the vault rail renders in the root
 * layout, so a project that briefly has no cards folder is visible to every other spec
 * running in parallel. Writing over the known files and removing only the extras keeps
 * the project continuously readable.
 */
async function reset(): Promise<void> {
  await fsp.mkdir(CARDS, { recursive: true });
  await fsp.writeFile(path.join(ROOT, "project.md"), PROJECT, "utf8");

  for (const [name, contents] of Object.entries(FILES)) {
    await fsp.writeFile(path.join(CARDS, name), contents, "utf8");
  }

  for (const name of await fsp.readdir(CARDS)) {
    if (!(name in FILES)) await fsp.rm(path.join(CARDS, name), { force: true });
  }

  await fsp.rm(path.join(ROOT, ".trash"), { recursive: true, force: true });
}

async function readCard(name: string): Promise<string> {
  return fsp.readFile(path.join(CARDS, name), "utf8");
}

async function snapshot(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const name of await fsp.readdir(CARDS)) {
    out.set(name, await fsp.readFile(path.join(CARDS, name), "utf8"));
  }
  return out;
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names].filter((n) => before.get(n) !== after.get(n)).sort();
}

/** dnd-kit needs intermediate pointer moves; a single jump is not recognised as a drag. */
async function dragCardTo(
  page: import("@playwright/test").Page,
  cardTestId: string,
  targetSelector: string,
): Promise<void> {
  const source = page.getByTestId(cardTestId);
  const target = page.locator(targetSelector);

  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("drag source or target not visible");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(
      from.x + from.width / 2 + ((to.x + to.width / 2 - from.x - from.width / 2) * i) / 8,
      from.y + from.height / 2 + ((to.y + 24 - from.y - from.height / 2) * i) / 8,
    );
  }
  await page.mouse.up();
}

test.beforeEach(async () => {
  await reset();
});

test.afterAll(async () => {
  await reset();
});

test("renders columns and cards from the vault", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);

  await expect(page.getByRole("region", { name: "Intake" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Shaping" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Done" })).toBeVisible();

  await expect(page.getByTestId("card-1")).toContainText("Alpha");
  await expect(page.getByTestId("card-1")).toHaveAttribute("data-column", "Intake");
  await expect(page.getByTestId("card-3")).toHaveAttribute("data-column", "Shaping");
});

test("shows criteria progress from the card body", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-1")).toContainText("1 of 2 done");
});

test("an edit to a card file on disk shows up on refresh", async ({ page }) => {
  await fsp.writeFile(path.join(CARDS, "0001-alpha.md"), card(1, "Alpha", "Done", "P1", 100));
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-1")).toHaveAttribute("data-column", "Done");
});

test("dragging across columns persists and rewrites exactly one file", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-1")).toBeVisible();

  const before = await snapshot();
  await dragCardTo(page, "card-1", '[data-testid="column-Done"]');

  await expect(page.getByTestId("card-1")).toHaveAttribute("data-column", "Done", {
    timeout: 10_000,
  });

  await expect(async () => {
    expect(await readCard("0001-alpha.md")).toContain("column: Done");
  }).toPass({ timeout: 10_000 });

  // The one-file-diff guarantee: a plain move must not touch its siblings.
  expect(changed(before, await snapshot())).toEqual(["0001-alpha.md"]);

  await page.reload();
  await expect(page.getByTestId("card-1")).toHaveAttribute("data-column", "Done");
});

test("a drag leaves the card body untouched", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-1")).toBeVisible();

  await dragCardTo(page, "card-1", '[data-testid="column-Shaping"]');
  await expect(page.getByTestId("card-1")).toHaveAttribute("data-column", "Shaping", {
    timeout: 10_000,
  });

  await expect(async () => {
    const raw = await readCard("0001-alpha.md");
    expect(raw).toContain("column: Shaping");
    expect(raw).toContain("Description for Alpha.");
    expect(raw).toContain("- [ ] First criterion");
    expect(raw).toContain("- [x] Second criterion");
  }).toPass({ timeout: 10_000 });
});

test("the detail pane opens and ticking a criterion writes to the file", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await page.getByTestId("card-1").click();

  const detail = page.getByTestId("card-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Alpha");
  await expect(detail).toContainText("First criterion");

  await detail.getByRole("checkbox", { name: /First criterion/ }).check();

  await expect(async () => {
    expect(await readCard("0001-alpha.md")).toContain("- [x] First criterion");
  }).toPass({ timeout: 10_000 });

  // Only the one marker changed.
  const raw = await readCard("0001-alpha.md");
  expect(raw).toContain("- [x] Second criterion");
  expect(raw).toContain("Description for Alpha.");
});

test("editing card metadata writes frontmatter and keeps the body", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await page.getByTestId("card-2").click();

  const detail = page.getByTestId("card-detail");
  await detail.getByLabel("Priority").selectOption("P1");

  await expect(async () => {
    expect(await readCard("0002-bravo.md")).toContain("priority: P1");
  }).toPass({ timeout: 10_000 });

  expect(await readCard("0002-bravo.md")).toContain("Description for Bravo.");
});

test("marking a card blocked shows on the tile", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await page.getByTestId("card-3").click();
  await page.getByTestId("card-detail").getByLabel("Blocked").check();

  await expect(async () => {
    expect(await readCard("0003-charlie.md")).toContain("blocked: true");
  }).toPass({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByTestId("card-3")).toContainText("Blocked");
});

test("creating a card writes a new file with the next id", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);

  await page.getByRole("button", { name: "Add a card to Shaping" }).click();
  await page.getByLabel("New card in Shaping").fill("Delta Force");
  await page.keyboard.press("Enter");

  await expect(async () => {
    const names = await fsp.readdir(CARDS);
    expect(names).toContain("0004-delta-force.md");
  }).toPass({ timeout: 10_000 });

  const raw = await readCard("0004-delta-force.md");
  expect(raw).toContain("column: Shaping");
  expect(raw).toContain("## Acceptance criteria");

  await expect(page.getByTestId("card-4")).toBeVisible();
});

test("deleting a card moves it to .trash rather than unlinking", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await page.getByTestId("card-2").click();

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "move to trash" }).click();

  await expect(async () => {
    expect(await fsp.readdir(CARDS)).not.toContain("0002-bravo.md");
    expect(await fsp.readdir(path.join(ROOT, ".trash"))).toContain("0002-bravo.md");
  }).toPass({ timeout: 10_000 });
});

test("a stale move is refused and the card returns to where it was", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-1")).toBeVisible();

  // Someone else writes the card between load and drag.
  await fsp.writeFile(path.join(CARDS, "0001-alpha.md"), card(1, "Alpha", "Intake", "P1", 105));

  await dragCardTo(page, "card-1", '[data-testid="column-Done"]');

  await expect(page.getByTestId("board-error")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("card-1")).toHaveAttribute("data-column", "Intake");
  expect(await readCard("0001-alpha.md")).toContain("column: Intake");
});

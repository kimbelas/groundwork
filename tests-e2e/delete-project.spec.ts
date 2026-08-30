import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Deleting a project.
 *
 * Serial, and for a stronger reason than most: every test here can remove the fixture from
 * disk, so a failure part-way through would leave the next test with no project to open.
 * The fixture is rebuilt from scratch before each test rather than reset in place.
 *
 * Its own project, per CLAUDE.md. Nothing else may touch sigma-deletable - a spec that
 * borrowed it would find it missing about half the time, which is the co-scheduling bug
 * that already cost an afternoon once.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "sigma-deletable";
const VAULT = path.resolve(import.meta.dirname, "fixture-vault");
const DIR = path.join(VAULT, SLUG);
const TRASH = path.join(VAULT, ".trash");

const PROJECT = `---
name: Sigma Deletable
slug: sigma-deletable
stage: shaping
health: green
archetype: internal-tool
columns: [Intake, Build, Done]
created: 2026-08-20
updated: 2026-08-20
---

The delete spec's own project, per CLAUDE.md. delete-project.spec.ts removes this folder
and rebuilds it before every test; nothing else may read or reset it.
`;

const LOG = `# Decision log

## 2026-08-20

Recorded so the delete has something whose loss would matter.
`;

const CARD = `---
id: 1
title: Only card
column: Intake
phase: 1
priority: P2
size: M
confidence: 0.5
blocked: false
order: 100
created: 2026-08-20
updated: 2026-08-20
---

A card that must travel with its project.

## Acceptance criteria

- [ ] Moves with the folder
`;

async function rebuildFixture(): Promise<void> {
  await fsp.rm(DIR, { recursive: true, force: true });
  await fsp.mkdir(path.join(DIR, "cards"), { recursive: true });
  await fsp.writeFile(path.join(DIR, "project.md"), PROJECT, "utf8");
  await fsp.writeFile(path.join(DIR, "log.md"), LOG, "utf8");
  await fsp.writeFile(path.join(DIR, "cards", "0001-only.md"), CARD, "utf8");
}

/** Everything this spec put in the vault's trash, and nothing anyone else put there. */
async function clearOurTrash(): Promise<void> {
  const entries = await fsp.readdir(TRASH).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(`${SLUG}-`))
      .map((name) => fsp.rm(path.join(TRASH, name), { recursive: true, force: true })),
  );
}

async function trashedCopies(): Promise<string[]> {
  const entries = await fsp.readdir(TRASH).catch(() => [] as string[]);
  return entries.filter((name) => name.startsWith(`${SLUG}-`));
}

test.beforeEach(async () => {
  await rebuildFixture();
  await clearOurTrash();
});

test.afterAll(async () => {
  await rebuildFixture();
  await clearOurTrash();
});

test.describe("deleting a project", () => {
  test("offers the delete at the foot of Settings and says where the files go", async ({
    page,
  }) => {
    await page.goto(`/p/${SLUG}/settings`);

    const panel = page.getByTestId("delete-project");
    await expect(panel).toBeVisible();
    // The promise the button makes. If this stops being true the wording has to change
    // with it, because it is the only thing telling the user the action is recoverable.
    await expect(panel).toContainText("trash");
    await expect(panel).toContainText("nothing is erased");
  });

  test("asks in a modal that names the project, and cancelling changes nothing", async ({
    page,
  }) => {
    await page.goto(`/p/${SLUG}/settings`);
    await page.getByTestId("delete-project-open").click();

    const dialog = page.getByTestId("delete-project-confirm");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Sigma Deletable");

    /*
     * Escape, not the Cancel button, and deliberately: this is the shared dismiss stack.
     * A confirmation that bound its own window listener would close and take something
     * else with it, which is the fourth bug of that shape this codebase has recorded.
     */
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await expect(page).toHaveURL(new RegExp(`/p/${SLUG}/settings`));
    expect(await trashedCopies()).toEqual([]);
  });

  test("moves the whole folder to the trash and says so after the page is gone", async ({
    page,
  }) => {
    await page.goto(`/p/${SLUG}/settings`);
    await page.getByTestId("delete-project-open").click();
    await page.getByTestId("delete-project-confirm").getByRole("button", { name: "Delete project" }).click();

    // The confirmation has to survive the navigation that destroys the surface that asked.
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Sigma Deletable");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Sigma Deletable" })).toHaveCount(0);

    // On disk: gone from the vault, whole underneath the trash. The card and the log are
    // the two whose loss would actually hurt, so they are the two checked.
    expect(await fsp.stat(DIR).catch(() => null)).toBeNull();

    const copies = await trashedCopies();
    expect(copies).toHaveLength(1);
    const moved = path.join(TRASH, copies[0]!);
    expect(await fsp.readFile(path.join(moved, "log.md"), "utf8")).toContain("Recorded so");
    expect(await fsp.readFile(path.join(moved, "cards", "0001-only.md"), "utf8")).toContain(
      "Only card",
    );
  });

  test("takes the project out of the rail as well as the dashboard", async ({ page }) => {
    await page.goto(`/p/${SLUG}/settings`);
    await expect(page.getByRole("navigation", { name: "Vault" }).getByRole("link", { name: "Sigma Deletable" })).toBeVisible();

    await page.getByTestId("delete-project-open").click();
    await page.getByTestId("delete-project-confirm").getByRole("button", { name: "Delete project" }).click();
    await expect(page).toHaveURL(/\/$/);

    // The rail renders in the root layout, so this is the check that the listing actually
    // refreshed rather than the dashboard merely rendering a filtered copy.
    await expect(page.getByRole("navigation", { name: "Vault" }).getByRole("link", { name: "Sigma Deletable" })).toHaveCount(0);
  });

  test("refuses when the project changed on disk after the page loaded", async ({ page }) => {
    await page.goto(`/p/${SLUG}/settings`);
    await expect(page.getByTestId("delete-project")).toBeVisible();

    // An AI apply or an Obsidian save landing between the page load and the click. What
    // the user confirmed is no longer what is on disk, so the delete must not proceed.
    await fsp.writeFile(
      path.join(DIR, "project.md"),
      PROJECT.replace("The delete spec's own project", "Rewritten underneath the page"),
      "utf8",
    );

    await page.getByTestId("delete-project-open").click();
    await page.getByTestId("delete-project-confirm").getByRole("button", { name: "Delete project" }).click();

    await expect(page.getByTestId("delete-project-error")).toBeVisible();
    await expect(page.getByTestId("delete-project-error")).toContainText("changed on disk");

    // Still there. A refused delete refuses completely.
    expect(await fsp.stat(DIR).catch(() => null)).not.toBeNull();
    expect(await trashedCopies()).toEqual([]);
  });

  test("centres the confirmation in the viewport", async ({ page }) => {
    /*
     * The guardrail for a real regression: Tailwind's preflight zeroes `margin` on every
     * element, which removes the `margin: auto` a UA gives `dialog:modal` - the only thing
     * centring it. The dialog rendered hard against the top-left corner and nothing failed,
     * because every other assertion here only cares that it is visible.
     */
    await page.goto(`/p/${SLUG}/settings`);
    await page.getByTestId("delete-project-open").click();

    const box = await page.getByTestId("delete-project-confirm").boundingBox();
    const view = page.viewportSize();
    expect(box).not.toBeNull();
    expect(view).not.toBeNull();

    const offX = Math.abs(box!.x + box!.width / 2 - view!.width / 2);
    const offY = Math.abs(box!.y + box!.height / 2 - view!.height / 2);
    expect(offX).toBeLessThan(2);
    expect(offY).toBeLessThan(2);
  });

  test("commits behind a filled red button, not an outlined one", async ({ page }) => {
    await page.goto(`/p/${SLUG}/settings`);
    await page.getByTestId("delete-project-open").click();

    const confirm = page
      .getByTestId("delete-project-confirm")
      .getByRole("button", { name: "Delete project" });

    const paint = await confirm.evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, text: style.color };
    });

    const rgb = (value: string): number[] =>
      (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

    // A fill, not a transparent outline: the red has to be the background.
    const [br, bg, bb] = rgb(paint.background);
    expect(br).toBeGreaterThan(140);
    expect(br).toBeGreaterThan(bg! + 60);
    expect(br).toBeGreaterThan(bb! + 60);

    // ...and the text on it is white, in both themes.
    const [tr, tg, tb] = rgb(paint.text);
    expect(Math.min(tr!, tg!, tb!)).toBeGreaterThan(240);
  });

  test("deletes from the dashboard row, without opening the project", async ({ page }) => {
    await page.goto("/");

    const row = page.getByRole("row", { name: /Sigma Deletable/ });
    await expect(row).toBeVisible();
    await row.getByTestId(`delete-row-${SLUG}`).click();

    const dialog = page.getByTestId("delete-project-confirm");
    await expect(dialog).toContainText("Sigma Deletable");
    await dialog.getByRole("button", { name: "Delete project" }).click();

    await expect(page.getByTestId("toast")).toContainText("Sigma Deletable");
    await expect(page.getByRole("row", { name: /Sigma Deletable/ })).toHaveCount(0);

    expect(await fsp.stat(DIR).catch(() => null)).toBeNull();
    expect(await trashedCopies()).toHaveLength(1);
  });

  test("names the project in each row button, so the buttons are told apart", async ({
    page,
  }) => {
    // Every row carries the same word. Without the project in the accessible name a
    // screen-reader user gets a list of identical "Delete" buttons.
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Delete Sigma Deletable" }),
    ).toBeVisible();
  });

  test("reports a refused row delete without losing the message", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId(`delete-row-${SLUG}`)).toBeVisible();

    // The row's baseline came from the server render, so an edit after that render is
    // exactly what the precondition is for - and the row has nowhere inline to complain.
    await fsp.writeFile(
      path.join(DIR, "project.md"),
      PROJECT.replace("The delete spec's own project", "Rewritten after the render"),
      "utf8",
    );

    await page.getByTestId(`delete-row-${SLUG}`).click();
    await page
      .getByTestId("delete-project-confirm")
      .getByRole("button", { name: "Delete project" })
      .click();

    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Could not delete");
    await expect(toast).toContainText("changed on disk");

    expect(await fsp.stat(DIR).catch(() => null)).not.toBeNull();
    expect(await trashedCopies()).toEqual([]);
  });
});

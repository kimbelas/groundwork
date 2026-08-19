import { expect, test } from "@playwright/test";

/**
 * The column manager, which had no end-to-end coverage at all.
 *
 * Six `data-testid`s were defined and none of them were ever asserted, so the panel could
 * have been broken for a long time without the suite noticing. It became the pilot for the
 * component primitives, and its rename moved from `window.prompt` to an inline field —
 * changing behaviour with nothing watching is how a regression ships.
 *
 * The server side is already covered by unit tests: `tests/vault-cards.test.ts` proves
 * `renameColumn` rewrites every affected card, refuses a name that already exists, and
 * refuses a column that does not. So these cases stay on the **surface** — what the panel
 * shows, what it refuses before sending, and what it leaves alone.
 *
 * Every case here is deliberately non-destructive: none clicks "Save order", so the fixture
 * vault is the same afterwards. Two Playwright workers share one fixture, and a spec that
 * mutates shared state makes an unrelated failure somewhere else look like a real bug.
 */

const BOARD = "/p/eta-board/board";

async function openPanel(page: import("@playwright/test").Page) {
  await page.goto(BOARD);
  await page.getByTestId("manage-columns").click();
  await expect(page.getByTestId("column-manager")).toBeVisible();
}

test.describe("column manager", () => {
  test("opens and lists the project's columns", async ({ page }) => {
    await openPanel(page);
    for (const name of ["Intake", "Shaping", "Done"]) {
      await expect(page.getByTestId(`column-row-${name}`)).toBeVisible();
    }
  });

  test("renaming happens inline, seeded with the current name", async ({ page }) => {
    // This is the behaviour that changed. `window.prompt` could not show the surrounding
    // columns, could not warn about a clash, and blocked the page — for an action that
    // rewrites every card in the column.
    await openPanel(page);
    await page.getByTestId("rename-Intake").click();

    const field = page.getByTestId("rename-input-Intake");
    await expect(field).toBeVisible();
    await expect(field).toHaveValue("Intake");
    await expect(page.getByTestId("rename-save-Intake")).toBeVisible();
  });

  test("escape abandons a rename without sending anything", async ({ page }) => {
    await openPanel(page);
    await page.getByTestId("rename-Intake").click();

    const field = page.getByTestId("rename-input-Intake");
    await field.fill("Triage");
    await field.press("Escape");

    await expect(field).toBeHidden();
    // The row is still called what it was, so nothing reached the server.
    await expect(page.getByTestId("column-row-Intake")).toBeVisible();
  });

  test("a name that already exists is refused before any request", async ({ page }) => {
    // Caught on the client, so the round trip never happens and the field stays open with
    // what was typed still in it.
    await openPanel(page);
    await page.getByTestId("rename-Intake").click();
    await page.getByTestId("rename-input-Intake").fill("Done");
    await page.getByTestId("rename-save-Intake").click();

    await expect(page.getByTestId("columns-error")).toContainText("already a column");
    await expect(page.getByTestId("rename-input-Intake")).toBeVisible();
    await expect(page.getByTestId("column-row-Intake")).toBeVisible();
  });

  test("adding a duplicate column is refused too", async ({ page }) => {
    await openPanel(page);
    // Case-insensitively: "done" and "Done" are the same column to anyone reading a board.
    await page.getByLabel("New column name").fill("done");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.getByTestId("columns-error")).toContainText("already a column");
  });

  test("reordering stops at the ends", async ({ page }) => {
    await openPanel(page);
    await expect(page.getByRole("button", { name: "Move Intake earlier" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move Done later" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move Intake later" })).toBeEnabled();
  });

  test("reordering is a draft until it is saved", async ({ page }) => {
    await openPanel(page);
    await page.getByRole("button", { name: "Move Intake later" }).click();

    // Save becomes available because the draft now differs from what is on disk.
    await expect(page.getByTestId("save-columns")).toBeEnabled();

    // Leaving without saving changes nothing: the board still reads as it did.
    await page.reload();
    await expect(page.getByRole("region", { name: "Intake" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Shaping" })).toBeVisible();
  });

  test("every control in the panel has an accessible name", async ({ page }) => {
    // The move buttons are icon-only since the pilot. An icon with no name is invisible to
    // a screen reader and unfindable by every `getByRole` in this suite, and it is exactly
    // the regression swapping a text glyph for an SVG invites.
    await openPanel(page);

    const unnamed = await page.getByTestId("column-manager").evaluate((panel) => {
      const bad: string[] = [];
      for (const el of Array.from(panel.querySelectorAll("button, input"))) {
        const name =
          el.getAttribute("aria-label") ??
          el.getAttribute("title") ??
          (el.textContent ?? "").trim();
        if (!name) bad.push(el.outerHTML.slice(0, 80));
      }
      return bad;
    });

    expect(unnamed).toEqual([]);
  });
});

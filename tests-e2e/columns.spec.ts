import { expect, test, type Page } from "@playwright/test";

/**
 * The column manager, which had no end-to-end coverage at all.
 *
 * Seven `data-testid`s were defined and none of them was ever asserted, so the panel could
 * have been broken for a long time without the suite noticing. It became the pilot for the
 * component primitives, and its rename moved from `window.prompt` to an inline field —
 * changing behaviour with nothing watching is how a regression ships.
 *
 * The server side is already covered by unit tests: `tests/vault-cards.test.ts` proves
 * `renameColumn` rewrites every affected card, refuses a name that already exists, and
 * refuses a column that does not. So these cases stay on the **surface** — what the panel
 * shows, what it refuses before sending, and what it leaves alone.
 *
 * Two rules this file follows, both learned the hard way:
 *
 *   1. **Nothing here saves.** No case clicks "Save order", so the fixture vault is
 *      identical afterwards. Two workers share one fixture, and a spec that mutates shared
 *      state makes an unrelated failure somewhere else look like a real bug.
 *   2. **No column name is hard-coded.** `board.spec.ts` rewrites this project's
 *      `project.md` from its own inline constant on every reset, so a spec that hard-codes
 *      the committed names passes or fails depending on which spec ran first — an
 *      order-dependent flake across parallel workers, and the hardest kind to diagnose.
 *      Every name below is read from the page.
 */

const BOARD = "/p/eta-board/board";

async function openPanel(page: Page) {
  await page.goto(BOARD);
  await page.getByTestId("manage-columns").click();
  await expect(page.getByTestId("column-manager")).toBeVisible();
}

/** The column names as the panel currently shows them, in order. */
async function columnNames(page: Page): Promise<string[]> {
  return page.getByTestId("column-manager").evaluate((panel) =>
    Array.from(panel.querySelectorAll("[data-testid^='column-row-']")).map(
      (row) => row.querySelector(".column-row-name")?.textContent?.trim() ?? "",
    ),
  );
}

test.describe("column manager", () => {
  test("opens and lists the project's columns", async ({ page }) => {
    await openPanel(page);
    const names = await columnNames(page);

    expect(names.length).toBeGreaterThan(1);
    expect(names.every(Boolean)).toBe(true);
    for (const name of names) {
      await expect(page.getByTestId(`column-row-${name}`)).toBeVisible();
    }
  });

  test("renaming happens inline, seeded with the current name", async ({ page }) => {
    // This is the behaviour that changed. `window.prompt` could not show the surrounding
    // columns, could not warn about a clash, and blocked the page — for an action that
    // rewrites every card in the column.
    await openPanel(page);
    const [first = ""] = await columnNames(page);

    await page.getByTestId(`rename-${first}`).click();
    const field = page.getByTestId(`rename-input-${first}`);

    await expect(field).toBeVisible();
    await expect(field).toHaveValue(first);
    await expect(page.getByTestId(`rename-save-${first}`)).toBeVisible();
  });

  test("escape abandons a rename without sending anything", async ({ page }) => {
    await openPanel(page);
    const [first = ""] = await columnNames(page);

    await page.getByTestId(`rename-${first}`).click();
    const field = page.getByTestId(`rename-input-${first}`);
    await field.fill("Something Else");
    await field.press("Escape");

    await expect(field).toBeHidden();
    // The row is still called what it was, so nothing reached the server.
    await expect(page.getByTestId(`column-row-${first}`)).toBeVisible();
  });

  test("renaming to an existing name is refused, ignoring case", async ({ page }) => {
    // Caught on the client, so the round trip never happens and the field stays open with
    // what was typed still in it. Lower-cased deliberately: two columns differing only by
    // case are the same column to anyone reading a board.
    await openPanel(page);
    const names = await columnNames(page);
    const [first = ""] = names;
    const other = names[names.length - 1] ?? "";

    await page.getByTestId(`rename-${first}`).click();
    await page.getByTestId(`rename-input-${first}`).fill(other.toLowerCase());
    await page.getByTestId(`rename-save-${first}`).click();

    await expect(page.getByTestId("columns-error")).toContainText("already a column");
    await expect(page.getByTestId(`rename-input-${first}`)).toBeVisible();
    await expect(page.getByTestId(`column-row-${first}`)).toBeVisible();
  });

  test("adding a duplicate column is refused too", async ({ page }) => {
    await openPanel(page);
    const [first = ""] = await columnNames(page);

    await page.getByLabel("New column name").fill(first.toLowerCase());
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.getByTestId("columns-error")).toContainText("already a column");
  });

  test("reordering stops at the ends", async ({ page }) => {
    await openPanel(page);
    const names = await columnNames(page);
    const first = names[0] ?? "";
    const last = names[names.length - 1] ?? "";

    await expect(page.getByRole("button", { name: `Move ${first} earlier` })).toBeDisabled();
    await expect(page.getByRole("button", { name: `Move ${last} later` })).toBeDisabled();
    await expect(page.getByRole("button", { name: `Move ${first} later` })).toBeEnabled();
  });

  test("reordering is a draft until it is saved", async ({ page }) => {
    await openPanel(page);
    const before = await columnNames(page);
    const first = before[0] ?? "";

    await page.getByRole("button", { name: `Move ${first} later` }).click();

    // Save becomes available because the draft now differs from what is on disk.
    await expect(page.getByTestId("save-columns")).toBeEnabled();
    expect(await columnNames(page)).not.toEqual(before);

    // Leaving without saving changes nothing: the board reads as it did.
    await page.reload();
    for (const name of before) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
  });

  test("every control in the panel has an accessible name", async ({ page }) => {
    // The move buttons are icon-only since the pilot. An icon with no name is invisible to
    // a screen reader and unfindable by every `getByRole` in this suite, and it is exactly
    // the regression that swapping a text glyph for an SVG invites.
    //
    // The rename row is opened first, because its field and buttons are behind a second
    // disclosure — the same blind spot the panel itself was in until this spec existed.
    await openPanel(page);
    const [first = ""] = await columnNames(page);
    await page.getByTestId(`rename-${first}`).click();
    await expect(page.getByTestId(`rename-input-${first}`)).toBeVisible();

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

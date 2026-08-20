import { expect, test } from "@playwright/test";

/**
 * Drawers and confirmations.
 *
 * The rule this suite enforces: **a drawer is where you work, a modal is where you decide.**
 * A drawer leaves the page behind it live; a confirmation blocks. Both dismiss through one
 * shared layer stack, so Escape closes exactly one thing.
 */

const BOARD = "eta-board";

test.describe("the card drawer", () => {
  test("opens from a card and names the card it opened", async ({ page }) => {
    await page.goto(`/p/${BOARD}/board`);
    await page.getByTestId("card-1").click();

    const drawer = page.getByTestId("card-detail");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { level: 2 })).toContainText("#1");
  });

  test("is a dialog that does not trap, which is the whole point", async ({ page }) => {
    /*
     * `aria-modal="false"` is not a detail. It is what tells a screen reader the rest of the
     * page is still available — and the board behind genuinely is, which the next test
     * exercises. A drawer claiming to be modal would be lying to exactly the users who
     * cannot see that the board is still there.
     */
    await page.goto(`/p/${BOARD}/board`);
    await page.getByTestId("card-1").click();

    const drawer = page.getByTestId("card-detail");
    await expect(drawer).toHaveAttribute("role", "dialog");
    await expect(drawer).toHaveAttribute("aria-modal", "false");
  });

  test("leaves the board clickable, so another card swaps the drawer", async ({ page }) => {
    // The behaviour that makes this a drawer and not a modal. A scrim would swallow this
    // click and force close-then-reopen for something that should be one action.
    await page.goto(`/p/${BOARD}/board`);
    await page.getByTestId("card-1").click();
    await expect(page.getByTestId("card-detail")).toContainText("#1");

    await page.getByTestId("card-2").click();
    await expect(page.getByTestId("card-detail")).toContainText("#2");
  });

  test("closes on Escape", async ({ page }) => {
    await page.goto(`/p/${BOARD}/board`);
    await page.getByTestId("card-1").click();
    await expect(page.getByTestId("card-detail")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("card-detail")).toHaveCount(0);
  });

  test("closes from its own Close button", async ({ page }) => {
    await page.goto(`/p/${BOARD}/board`);
    await page.getByTestId("card-1").click();

    await page.getByTestId("card-detail").getByTestId("drawer-close").click();
    await expect(page.getByTestId("card-detail")).toHaveCount(0);
  });

  test("returns focus to what opened it", async ({ page }) => {
    /*
     * Easy to skip and obvious when missing: without this, closing a drawer leaves focus on
     * the document, so the next Tab starts from the top of the page rather than from the
     * card the user was just on.
     */
    await page.goto(`/p/${BOARD}/board`);
    await page.getByTestId("card-1").click();
    await expect(page.getByTestId("card-detail")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("card-1")).toBeFocused();
  });
});

test.describe("Escape closes exactly one layer", () => {
  test("a confirmation over a drawer closes only the confirmation", async ({ page }) => {
    /*
     * The bug the shared dismiss stack exists to prevent.
     *
     * Every surface used to bind its own keydown on `window`, so both handlers fired: the
     * user cancelled the confirmation and lost the drawer behind it too. `stopPropagation`
     * cannot fix that, because both listeners are on the same target.
     */
    await page.goto(`/p/${BOARD}/board`);
    await page.getByTestId("card-1").click();
    await expect(page.getByTestId("card-detail")).toBeVisible();

    await page.getByRole("button", { name: "Move to trash" }).click();
    await expect(page.getByTestId("confirm-trash")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("confirm-trash")).toHaveCount(0);
    await expect(page.getByTestId("card-detail")).toBeVisible();
  });

  test("a second Escape then closes the drawer", async ({ page }) => {
    await page.goto(`/p/${BOARD}/board`);
    await page.getByTestId("card-1").click();
    await page.getByRole("button", { name: "Move to trash" }).click();

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("card-detail")).toHaveCount(0);
  });

  test("cancelling the confirmation changes nothing", async ({ page }) => {
    await page.goto(`/p/${BOARD}/board`);
    await page.getByTestId("card-1").click();
    await page.getByRole("button", { name: "Move to trash" }).click();

    await page.getByTestId("confirm-trash").getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByTestId("confirm-trash")).toHaveCount(0);
    await expect(page.getByTestId("card-detail")).toBeVisible();
    await expect(page.getByTestId("card-1")).toBeVisible();
  });

  test("the confirmation says where the file goes", async ({ page }) => {
    // A destructive prompt that cannot explain itself gets clicked through. This is the
    // part `window.confirm` could not do and the reason it was replaced.
    await page.goto(`/p/${BOARD}/board`);
    await page.getByTestId("card-1").click();
    await page.getByRole("button", { name: "Move to trash" }).click();

    const confirm = page.getByTestId("confirm-trash");
    await expect(confirm).toContainText(".trash");
    await expect(confirm).toContainText("Nothing is deleted");
  });
});

test.describe("the new project drawer", () => {
  test("opens from the trigger, which stays on the page", async ({ page }) => {
    /*
     * It used to REPLACE its own trigger with an inline form, so the form appeared wherever
     * the button had been — floating at the top-right, detached from the list — and there
     * was nothing left to return focus to on cancel.
     */
    await page.goto("/");
    await page.getByTestId("new-project").click();

    await expect(page.getByTestId("new-project-form")).toBeVisible();
    await expect(page.getByTestId("new-project")).toBeVisible();
  });

  test("keeps the project list readable behind it", async ({ page }) => {
    // Which is the point of a drawer here: it is how you notice you already have a project
    // by that name.
    await page.goto("/");
    await page.getByTestId("new-project").click();

    // Scoped to the table: the rail lists every project too, so an unscoped query is a
    // strict-mode violation rather than a real assertion. Same scoping dashboard.spec uses.
    await expect(
      page.getByRole("table").getByRole("link", { name: "Alpha Portal" }),
    ).toBeVisible();
  });

  test("shows the folder name before the project is created", async ({ page }) => {
    // The slug becomes an immutable directory name, so seeing it afterwards would mean
    // renaming a folder by hand to fix a typo.
    await page.goto("/");
    await page.getByTestId("new-project").click();
    await page.getByLabel("Project name").fill("Tenant Portal Rebuild");

    await expect(page.getByTestId("slug-preview")).toContainText("tenant-portal-rebuild");
  });

  test("closes on Escape and returns focus to the trigger", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("new-project").click();
    await expect(page.getByTestId("new-project-form")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("new-project-form")).toHaveCount(0);
    await expect(page.getByTestId("new-project")).toBeFocused();
  });

  test("cancels without creating anything", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("new-project").click();
    await page.getByLabel("Project name").fill("Should Not Exist");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("new-project-form")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Should Not Exist" })).toHaveCount(0);
  });
});

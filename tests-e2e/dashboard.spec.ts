import { expect, test } from "@playwright/test";

/**
 * The dashboard against the fixture vault. Each assertion maps to a "done when" in
 * docs/01-features.md rather than to an implementation detail.
 */

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders every healthy project from the vault", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();

    const table = page.getByRole("table");
    await expect(table.getByRole("link", { name: "Alpha Portal" })).toBeVisible();
    await expect(table.getByRole("link", { name: "Beta Blank" })).toBeVisible();
    await expect(table.getByRole("link", { name: "Gamma Questions" })).toBeVisible();
  });

  test("a malformed project is reported without taking the page down", async ({ page }) => {
    const row = page.getByRole("row", { name: /epsilon-broken/ });
    await expect(row).toBeVisible();
    await expect(row.getByText("unreadable")).toBeVisible();

    // The healthy projects are unaffected — this is the whole point of the guarantee.
    await expect(page.getByRole("table").getByRole("link", { name: "Alpha Portal" })).toBeVisible();
  });

  test("archived projects are hidden until the toggle is used", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Delta Archived" })).toHaveCount(0);

    await page.getByRole("link", { name: /show archived/ }).click();
    await expect(page.getByRole("link", { name: "Delta Archived" })).toBeVisible();

    await page.getByRole("link", { name: "hide archived" }).click();
    await expect(page.getByRole("link", { name: "Delta Archived" })).toHaveCount(0);
  });

  test("phase progress counts the final column as done", async ({ page }) => {
    const row = page.getByRole("row", { name: /Alpha Portal/ });
    await expect(row.getByText("1/2", { exact: true })).toBeVisible();
  });
});

test.describe("next action heuristic", () => {
  test("a blocked card outranks everything", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("row", { name: /Alpha Portal/ });
    await expect(row.getByRole("link", { name: /Unblock "Waiting on WSDL access"/ })).toBeVisible();
  });

  test("open questions win when nothing is blocked", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("row", { name: /Gamma Questions/ });
    // Two open, one answered — the answered one must not be counted.
    await expect(row.getByRole("link", { name: "Answer 2 open questions" })).toBeVisible();
  });

  test("an empty brief asks for the brief", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("row", { name: /Beta Blank/ });
    await expect(row.getByRole("link", { name: "Write the brief" })).toBeVisible();
  });

  test("the next action links to the matching view", async ({ page }) => {
    await page.goto("/");
    const link = page
      .getByRole("row", { name: /Gamma Questions/ })
      .getByRole("link", { name: /Answer 2 open questions/ });
    await expect(link).toHaveAttribute("href", "/p/gamma-questions/questions");
  });
});

test.describe("vault rail", () => {
  test("lists projects and badges unanswered questions", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("navigation", { name: "Vault" });

    await expect(rail.getByRole("link", { name: /Alpha Portal/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /Gamma Questions/ })).toContainText("2?");

    // Archived projects stay out of the rail entirely.
    await expect(rail.getByRole("link", { name: /Delta Archived/ })).toHaveCount(0);
  });
});

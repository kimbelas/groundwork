import { expect, test } from "@playwright/test";

/**
 * The project Settings tab.
 *
 * The repository, export and delete panels used to sit at the foot of the Brief. None of them
 * is part of the plan — they are things you do to the project — and stacked under the editor
 * they pushed the AI panel, the thing you come to the Brief for, into the middle of a long
 * scroll.
 *
 * Reads only, and it borrows `nu-repo-link` from `repo.spec.ts` for one navigation check
 * where a connected repo has to exist. That spec resets the file in `beforeEach`; nothing
 * here writes, so there is nothing to race.
 */

const SLUG = "alpha-portal";

test("the Brief no longer carries the three panels", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await expect(page.getByTestId("ai-panel")).toBeVisible();

  // The guardrail for the move. Without it, re-adding one of these to the Brief is a silent
  // regression: every panel still works, just in the wrong place.
  await expect(page.getByTestId("repo-panel")).toHaveCount(0);
  await expect(page.getByTestId("export-panel")).toHaveCount(0);
  await expect(page.getByTestId("delete-project")).toHaveCount(0);
});

test("Settings carries all three", async ({ page }) => {
  await page.goto(`/p/${SLUG}/settings`);

  await expect(page.getByTestId("repo-panel")).toBeVisible();
  await expect(page.getByTestId("export-panel")).toBeVisible();
  await expect(page.getByTestId("delete-project")).toBeVisible();
});

test("the tab is in the project nav and lights up on its own page", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);

  /*
   * Scoped to the project nav. The rail carries a link named "Settings" too — the app-level
   * one — so an unscoped locator is ambiguous on every project page.
   */
  const tabs = page.getByRole("navigation", { name: "Project views" });
  const tab = tabs.getByRole("link", { name: "Settings" });
  await expect(tab).toBeVisible();

  await tab.click();
  await expect(page).toHaveURL(new RegExp(`/p/${SLUG}/settings$`));
  await expect(tab).toHaveAttribute("aria-current", "page");
});

test("the Brief tab is not lit while Settings is open", async ({ page }) => {
  await page.goto(`/p/${SLUG}/settings`);
  const tabs = page.getByRole("navigation", { name: "Project views" });

  await expect(tabs.getByRole("link", { name: "Brief" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("fits a phone without sideways scroll", async ({ page }) => {
  // Three panels of controls, one of them a path that does not wrap. Every screen at 390px.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/nu-repo-link/settings`);
  await expect(page.getByTestId("repo-panel")).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);
});

import { expect, test } from "@playwright/test";

/**
 * The card number, and the search bar that finds it.
 *
 * The id was always permanent — `lib/vault.ts` never reuses one, even after a card is
 * trashed — but it lived only in the URL and the drawer header, so the only way to quote a
 * card was to open it. And search, which already covered the whole vault, was a link in the
 * rail rather than a field you could reach from wherever you were.
 *
 * Its own project, per CLAUDE.md. Nothing here writes, so nothing here resets.
 */

const SLUG = "phi-ticket";

test("the card tile carries its number", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-3")).toContainText("#3");
  await expect(page.getByTestId("card-11")).toContainText("#11");
});

test("the search bar is in the shell, so it is on every page", async ({ page }) => {
  for (const url of ["/", `/p/${SLUG}/board`, `/p/${SLUG}/brief`]) {
    await page.goto(url);
    await expect(page.getByTestId("global-search")).toBeVisible();
  }
});

test("a card number typed into the bar lands on that card", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);

  await page.getByTestId("global-search").fill("#3");
  await page.getByTestId("global-search").press("Enter");

  // The query lives in the URL, so the result set is linkable and survives a reload.
  await expect(page).toHaveURL(/\/search\?q=%233/);
  await expect(page.getByTestId("search-results")).toBeVisible();

  /*
   * Scoped to this project's group, because ids are per project: several fixture projects
   * legitimately have a card 3, and all of them are correct answers. A result is a link
   * named for where it was found, with the matching line beside it.
   */
  const group = page.getByTestId(`search-group-${SLUG}`);
  await expect(group).toContainText("Findable by its number");
  await expect(group.getByRole("link", { name: "Card" })).toHaveAttribute(
    "href",
    `/p/${SLUG}/cards/3`,
  );
});

test("a bare number works, which the text search alone refuses as too short", async ({
  page,
}) => {
  await page.goto("/search?q=3");
  await expect(page.getByTestId(`search-group-${SLUG}`)).toContainText(
    "Findable by its number",
  );
});

test("the bar and the search page's own field stay separately addressable", async ({ page }) => {
  /*
   * The bar renders on `/search` too, so its label must not be the one that page already
   * uses. Two controls sharing an accessible name is an ambiguous locator, and the suite
   * binds to both of these.
   */
  await page.goto("/search?q=3");
  await expect(page.getByLabel("Search all projects")).toBeVisible();
  await expect(page.getByLabel("Search the vault")).toBeVisible();
});

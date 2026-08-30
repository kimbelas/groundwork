import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * A card as a page.
 *
 * Its own fixture project, per CLAUDE.md, and read-only apart from one throwaway card a
 * test writes and removes itself. Nothing here runs the AI: the run lock is global, so
 * every test that enhances lives in ai.spec.ts.
 */
const SLUG = "rho-card-page";
const CARDS = path.resolve(import.meta.dirname, "fixture-vault", SLUG, "cards");

test("renders the description, the criteria and what links here", async ({ page }) => {
  await page.goto(`/p/${SLUG}/cards/1`);
  const card = page.getByTestId("card-page");
  await expect(card).toBeVisible();

  await expect(card.getByRole("heading", { level: 2 })).toContainText("#1 · Alpha Card");

  // Two paragraphs, inline emphasis rendered as elements — never as HTML.
  const description = card.getByTestId("card-description");
  await expect(description.locator("p")).toHaveCount(2);
  await expect(description.locator("strong")).toHaveText("emphasis");
  await expect(description.locator("code")).toHaveText("code span");

  // The same editor as the drawer: criteria are live.
  await expect(card.getByTestId("criteria")).toContainText("First criterion");
  await expect(card.getByRole("checkbox", { name: /Second criterion/ })).toBeChecked();

  // Bravo links here by title; the backlink points at Bravo's own page.
  const backlinks = card.getByTestId("backlinks");
  await expect(backlinks).toContainText("Rho Card Page · Bravo");
  await expect(backlinks.getByRole("link")).toHaveAttribute("href", `/p/${SLUG}/cards/2`);
});

test("the Board tab stays lit on a card page", async ({ page }) => {
  await page.goto(`/p/${SLUG}/cards/1`);
  const tabs = page.getByRole("navigation", { name: "Project views" });
  await expect(tabs.getByRole("link", { name: /^Board/ })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: /^Brief/ })).not.toHaveAttribute("aria-current", "page");
});

test("an unknown or malformed card id is a 404, not an error page", async ({ page }) => {
  expect((await page.goto(`/p/${SLUG}/cards/999`))?.status()).toBe(404);
  expect((await page.goto(`/p/${SLUG}/cards/abc`))?.status()).toBe(404);
});

test("the drawer links to the page, in a new tab", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await page.getByTestId("card-1").click();
  const link = page.getByTestId("card-detail").getByTestId("card-open-page");
  await expect(link).toHaveAttribute("href", `/p/${SLUG}/cards/1`);
  await expect(link).toHaveAttribute("target", "_blank");
});

test("Ctrl-clicking a tile opens the page in a new tab; a plain click opens the drawer", async ({
  page,
  context,
}) => {
  await page.goto(`/p/${SLUG}/board`);

  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByTestId("card-1").click({ modifiers: ["Control"] }),
  ]);
  await popup.waitForLoadState();
  expect(popup.url()).toContain(`/p/${SLUG}/cards/1`);
  await expect(popup.getByTestId("card-page")).toBeVisible();
  await popup.close();

  // The modifier click did not also open the drawer.
  await expect(page.getByTestId("card-detail")).toHaveCount(0);
  await page.getByTestId("card-1").click();
  await expect(page.getByTestId("card-detail")).toBeVisible();
});

test("Back to board goes back to the board", async ({ page }) => {
  await page.goto(`/p/${SLUG}/cards/1`);
  await page.getByTestId("card-back").click();
  await expect(page.getByTestId("board")).toBeVisible();
});

test("a card whose frontmatter did not parse renders a notice, not a 500", async ({ page }) => {
  const broken = path.join(CARDS, "0003-broken.md");
  await fsp.writeFile(
    broken,
    "---\nid: 3\ntitle: Broken\ncolumn: Intake\ntags: [unclosed\n---\n\nA body.\n",
    "utf8",
  );
  try {
    const res = await page.goto(`/p/${SLUG}/cards/3`);
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("card-page")).toBeVisible();
    await expect(page.getByTestId("card-broken")).toContainText("did not parse");
  } finally {
    await fsp.rm(broken, { force: true });
  }
});

test("fits a phone without sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${SLUG}/cards/1`);
  await expect(page.getByTestId("criteria")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
});

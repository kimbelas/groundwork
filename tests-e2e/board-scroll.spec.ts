import { expect, test } from "@playwright/test";

/**
 * A board lane that is longer than the screen.
 *
 * A first synthesis puts a dozen or more cards into one column. Uncapped, the lane grew past
 * the bottom of the viewport, so comparing two columns meant scrolling the page down and the
 * board sideways at once — and the column headings left the screen while you did it.
 *
 * Its own project, per CLAUDE.md: `upsilon-tall` has seven cards in one lane and two in
 * another, which is exactly the asymmetry the cap has to handle. Nothing here writes, so
 * nothing here resets.
 */

const SLUG = "upsilon-tall";

/** Wide and short: the shape that overruns first, and the one a laptop actually has. */
const VIEWPORT = { width: 1440, height: 900 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
});

test("a long lane scrolls inside itself instead of growing past the screen", async ({
  page,
}) => {
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-1")).toBeVisible();

  const lane = await page.getByTestId("column-Backlog").evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));

  // Seven cards is more than the cap, so the lane has to be the thing that scrolls.
  expect(lane.overflowY).toBe("auto");
  expect(lane.scrollHeight).toBeGreaterThan(lane.clientHeight + 1);
});

test("the lane stays inside the viewport, which is the point of the cap", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-1")).toBeVisible();

  const column = await page.locator(".column").first().boundingBox();
  expect(column).not.toBeNull();

  /*
   * The cap is `min(840px, 70vh)` — about five measured cards, and never more than most of
   * the screen. A pure pixel cap would still overrun a 900px laptop, which is the failure
   * this test exists to catch rather than the card count.
   */
  expect(column!.height).toBeLessThan(VIEWPORT.height);
});

test("a short lane does not scroll, and is not padded out to the cap", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-8")).toBeVisible();

  const lane = await page.getByTestId("column-Build").evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
  }));

  // `max-height` caps without stretching. A lane of two must still be a lane of two.
  expect(lane.scrollHeight).toBeLessThanOrEqual(lane.clientHeight + 1);
});

test("Add a card stays reachable without scrolling past the cards", async ({ page }) => {
  /*
   * The half of the problem that made the cap worse before it made it better: inside the
   * scroll area the button sat below the last card, so adding to a lane of seven meant
   * scrolling past six you were not adding.
   */
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-1")).toBeVisible();

  const add = page.getByRole("button", { name: "Add a card to Backlog" });
  await expect(add).toBeInViewport();

  // And it is genuinely outside the scrolling list, not merely visible at rest.
  const inside = await page
    .getByTestId("column-Backlog")
    .evaluate(
      (el) => el.querySelector('button[aria-label="Add a card to Backlog"]') !== null,
    );
  expect(inside).toBe(false);
});

test("the first card is still reachable after scrolling the lane", async ({ page }) => {
  await page.goto(`/p/${SLUG}/board`);
  await expect(page.getByTestId("card-1")).toBeVisible();

  const lane = page.getByTestId("column-Backlog");
  await lane.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByTestId("card-7")).toBeInViewport();

  await lane.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.getByTestId("card-1")).toBeInViewport();
});

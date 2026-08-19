import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Wiki-links, backlinks and vault search.
 *
 * Serial: the tests write links into fixture briefs, and the link graph spans the whole
 * vault, so two of these running at once would see each other's edits.
 */
test.describe.configure({ mode: "serial" });

const VAULT = path.resolve(import.meta.dirname, "fixture-vault");
const ALPHA = path.join(VAULT, "alpha-portal", "project.md");
const GAMMA = path.join(VAULT, "gamma-questions", "project.md");

const ALPHA_ORIGINAL = `---
name: Alpha Portal
slug: alpha-portal
stage: shaping
health: amber
archetype: client
columns: [Intake, Shaping, Build, Done]
created: 2026-08-01
updated: 2026-08-10
---

A brief with actual content, so this project does not fall into the empty-brief branch.
`;

const GAMMA_ORIGINAL = `---
name: Gamma Questions
slug: gamma-questions
stage: building
health: green
archetype: internal-tool
columns: [Intake, Build, Done]
created: 2026-08-03
updated: 2026-08-09
---

This project has a brief and two unanswered questions, so the questions branch wins.
`;

async function reset(): Promise<void> {
  await fsp.writeFile(ALPHA, ALPHA_ORIGINAL, "utf8");
  await fsp.writeFile(GAMMA, GAMMA_ORIGINAL, "utf8");
}

test.beforeEach(async () => {
  await reset();
});

test.afterAll(async () => {
  await reset();
});

test.describe("backlinks", () => {
  test("a link in one brief appears as a backlink on the target", async ({ page }) => {
    await fsp.writeFile(
      ALPHA,
      `${ALPHA_ORIGINAL}\nSee [[gamma-questions]] for the ops side of this.\n`,
      "utf8",
    );

    await page.goto("/p/gamma-questions/brief");
    const panel = page.getByTestId("backlinks");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // Named source, and the line it was linked from — the useful part is *why*.
    await expect(panel).toContainText("Alpha Portal");
    await expect(panel).toContainText("See [[gamma-questions]] for the ops side");
  });

  test("the backlink links back to its source", async ({ page }) => {
    await fsp.writeFile(ALPHA, `${ALPHA_ORIGINAL}\nSee [[gamma-questions]].\n`, "utf8");

    await page.goto("/p/gamma-questions/brief");
    await page.getByTestId("backlinks").getByRole("link", { name: "Alpha Portal" }).click();
    await expect(page).toHaveURL(/\/p\/alpha-portal\/brief$/);
  });

  test("no panel is shown when nothing links here", async ({ page }) => {
    await page.goto("/p/gamma-questions/brief");
    await expect(page.getByTestId("backlinks")).toHaveCount(0);
  });

  test("an unresolved link creates no backlink anywhere", async ({ page }) => {
    await fsp.writeFile(ALPHA, `${ALPHA_ORIGINAL}\nSee [[no-such-thing]].\n`, "utf8");

    await page.goto("/p/gamma-questions/brief");
    await expect(page.getByTestId("backlinks")).toHaveCount(0);
  });

  test("an edit made outside the app updates backlinks on the next load", async ({ page }) => {
    // The graph is cached, so this proves the cache is actually invalidated by the
    // filesystem watcher rather than only by writes made through the app.
    await page.goto("/p/gamma-questions/brief");
    await expect(page.getByTestId("backlinks")).toHaveCount(0);

    await fsp.writeFile(ALPHA, `${ALPHA_ORIGINAL}\nLater link to [[gamma-questions]].\n`, "utf8");

    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("backlinks")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 25_000 });
  });
});

test.describe("search", () => {
  test("finds text across briefs, cards and logs, grouped by project", async ({ page }) => {
    await page.goto("/search?q=WSDL");

    const results = page.getByTestId("search-results");
    await expect(results).toBeVisible({ timeout: 20_000 });
    await expect(results).toContainText("WSDL");
  });

  test("a result links to the view that contains it", async ({ page }) => {
    await page.goto("/search?q=criterion");
    await expect(page.getByTestId("search-results")).toBeVisible({ timeout: 20_000 });

    const link = page.getByTestId("search-results").getByRole("link").first();
    await expect(link).toHaveAttribute("href", /\/p\/[a-z-]+\//);
  });

  test("says so plainly when nothing matches", async ({ page }) => {
    await page.goto("/search?q=zzzznotpresentzzzz");
    await expect(page.getByTestId("search-empty")).toBeVisible();
  });

  test("asks for more than one character", async ({ page }) => {
    await page.goto("/search?q=a");
    await expect(page.getByText("Type at least two characters.")).toBeVisible();
  });

  test("the query lives in the URL so a result set is linkable", async ({ page }) => {
    await page.goto("/search");
    await page.getByLabel("Search the vault").fill("WSDL");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page).toHaveURL(/\/search\?q=WSDL$/);
    await expect(page.getByTestId("search-results")).toBeVisible({ timeout: 20_000 });
  });

  test("search is reachable from the rail", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Vault" }).getByRole("link", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search$/);
  });
});

test.describe("search API", () => {
  test("returns hits with their location", async ({ request }) => {
    const res = await request.get("/api/search?q=WSDL");
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as { hits: { slug: string; where: string }[] };
    expect(body.hits.length).toBeGreaterThan(0);
    expect(body.hits[0]?.where).toBeTruthy();
  });

  test("refuses a one-character query rather than scanning the vault", async ({ request }) => {
    const res = await request.get("/api/search?q=a");
    expect(res.ok()).toBe(true);
    expect((await res.json()).hits).toEqual([]);
  });

  test("caps the result count", async ({ request }) => {
    // "e" would match nearly every line; the limit keeps that bounded.
    const res = await request.get("/api/search?q=the&limit=5");
    const body = (await res.json()) as { hits: unknown[] };
    expect(body.hits.length).toBeLessThanOrEqual(5);
  });
});

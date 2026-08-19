import { expect, test } from "@playwright/test";

test.describe("project workspace", () => {
  test("tabs mark the current view and reach every phase-2 stub", async ({ page }) => {
    await page.goto("/p/alpha-portal/brief");

    const tabs = page.getByRole("navigation", { name: "Project views" });
    await expect(tabs.getByRole("link", { name: "Brief" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Every view is now built; none of them are stubs.
    for (const [label, testId] of [
      ["Board", "board"],
      ["Roadmap", "phase-track"],
      ["Log", "decision-log"],
      ["Questions", "questions-list"],
    ] as const) {
      await tabs.getByRole("link", { name: new RegExp(`^${label}`) }).click();
      await expect(page.getByTestId(testId)).toBeVisible();
      await expect(tabs.getByRole("link", { name: new RegExp(`^${label}`) })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });

  test("the questions tab badges the unanswered count", async ({ page }) => {
    await page.goto("/p/gamma-questions/brief");
    const tab = page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("link", { name: /Questions/ });
    await expect(tab).toContainText("2");
  });

  test("a project with no open questions has no badge", async ({ page }) => {
    await page.goto("/p/alpha-portal/brief");
    const tab = page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("link", { name: /Questions/ });
    await expect(tab).toHaveText("Questions");
  });

  test("an unknown project 404s rather than erroring", async ({ page }) => {
    const res = await page.goto("/p/no-such-project/brief");
    expect(res?.status()).toBe(404);
  });

  test("a slug that is not a legal slug also 404s", async ({ page }) => {
    const res = await page.goto("/p/NOT_A_SLUG/brief");
    expect(res?.status()).toBe(404);
  });

  test("the rail navigates into a project", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Vault" })
      .getByRole("link", { name: "Alpha Portal" })
      .click();
    await expect(page).toHaveURL(/\/p\/alpha-portal\/brief$/);
    await expect(page.getByRole("heading", { level: 1, name: "Alpha Portal" })).toBeVisible();
  });

  test("an empty brief shows the placeholder prompt", async ({ page }) => {
    await page.goto("/p/beta-blank/brief");
    await expect(page.getByTestId("brief-editor")).toContainText(
      "Dump the high-level overview here",
    );
  });
});

test.describe("write API", () => {
  test("rejects a cross-site write", async ({ request }) => {
    const res = await request.patch("/api/vault/alpha-portal", {
      headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      data: { kind: "brief", body: "csrf", expectedMtimeMs: 1 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/Cross-site/);
  });

  test("rejects a write with a mismatched Origin", async ({ request }) => {
    const res = await request.patch("/api/vault/alpha-portal", {
      headers: { origin: "http://evil.example", "content-type": "application/json" },
      data: { kind: "brief", body: "csrf", expectedMtimeMs: 1 },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects a body missing its write precondition", async ({ request }) => {
    const res = await request.patch("/api/vault/alpha-portal", {
      headers: { "content-type": "application/json" },
      data: { kind: "brief", body: "no baseline" },
    });
    expect(res.status()).toBe(422);
  });

  test("rejects a traversal slug", async ({ request }) => {
    const res = await request.get("/api/vault/..%2F..%2Fetc");
    expect([400, 404]).toContain(res.status());
  });
});

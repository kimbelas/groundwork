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

test.describe("the rail fits the screen", () => {
  /*
   * The regression this pins.
   *
   * The search bar became permanent at every width, which put a 67px bar above the shell -
   * and the rail was still `height: 100vh` starting below it, so it ended 67px past the
   * bottom of the viewport. The theme toggle rendered at y=901 in a 900px window: present in
   * the DOM, visible to a test that only asked whether it existed, and unreachable without
   * scrolling a rail nobody expects to scroll.
   *
   * Asserted on geometry rather than on a CSS property, because every declaration involved
   * was correct on its own - it was the arithmetic between two of them that was wrong.
   */
  /*
   * There is deliberately no "the footer is visible without scrolling" test.
   *
   * Whether it fits depends on how many projects the fixture vault happens to hold, so such
   * a test passes today and fails the next time a spec adds a fixture project - the same
   * cross-spec coupling CLAUDE.md already records as costing an afternoon. The two below are
   * true regardless of the vault: the rail never claims more height than the viewport has,
   * and its footer is reachable by scrolling the rail itself.
   */

  test("the rail ends where the viewport does", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Vault" })).toBeVisible();

    const fits = await page.evaluate(() => {
      const rail = document.querySelector(".rail");
      if (!rail) return null;
      // A pixel of tolerance for sub-pixel rounding, and no more: 67px of overflow is the
      // bug, and it is exactly the height of the bar above it.
      return rail.getBoundingClientRect().bottom <= window.innerHeight + 1;
    });
    expect(fits).toBe(true);
  });

  test("short viewports scroll the rail rather than hiding its footer", async ({ page }) => {
    // A laptop with a browser toolbar. The rail scrolls internally; the footer is still
    // reachable, which is the property that matters rather than everything fitting at once.
    await page.setViewportSize({ width: 1400, height: 560 });
    await page.goto("/");

    const rail = page.getByRole("navigation", { name: "Vault" });
    await expect(rail).toBeVisible();
    await rail.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.getByTestId("theme-toggle")).toBeInViewport();
  });
});

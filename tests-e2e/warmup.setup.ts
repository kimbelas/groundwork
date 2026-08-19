import { expect, test as setup } from "@playwright/test";

/**
 * Compile every route once before the suite runs.
 *
 * The e2e server is a dev server, so the first request to a route pays a Turbopack
 * compile of one to three seconds. A test that walks four tabs was paying four of them
 * while competing with other workers for CPU, which made it fail on timing alone —
 * flakiness that says nothing about the product.
 *
 * Warming here moves that cost out of the assertions and into one predictable step.
 */
const ROUTES = [
  "/",
  "/?archived=1",
  "/p/alpha-portal/brief",
  "/p/alpha-portal/board",
  "/p/alpha-portal/roadmap",
  "/p/alpha-portal/log",
  "/p/alpha-portal/questions",
  "/p/eta-board/board",
  "/api/vault/alpha-portal",
  "/api/cards?slug=eta-board&id=1",
];

setup("warm every route", async ({ request }) => {
  setup.setTimeout(180_000);

  for (const route of ROUTES) {
    const res = await request.get(route);
    expect(res.status(), `warming ${route}`).toBeLessThan(500);
  }
});

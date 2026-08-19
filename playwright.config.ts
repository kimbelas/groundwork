import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a fixture vault, never the developer's real one. Determinism here
 * is not optional: the dashboard's content *is* the filesystem, so a shared vault
 * would make these tests fail whenever someone edits a note.
 *
 * Port 4849 so a dev server already running on 4848 is never disturbed.
 */
const PORT = Number(process.env.GROUNDWORK_E2E_PORT ?? 4849);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests-e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /**
   * Pinned, not left to Playwright's default.
   *
   * Every worker drives a browser against ONE Next dev server, and in dev each request
   * does real filesystem work. On a 4-core machine, four workers oversubscribe the box
   * badly enough that page loads exceed the test timeout — and because the default is
   * derived from core count, the suite's outcome quietly depended on ambient machine
   * load. Two is what this server can actually serve.
   */
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [["html", { open: "never" }]] : [["list"]],

  /**
   * The suite runs against a dev server, so the first request to each route pays a
   * Turbopack compile of 1-3s. A test that walks four routes can exceed the 5s expect
   * default purely from that, with several workers competing for CPU. These ceilings
   * are sized for compile latency, not for hiding slow assertions — a genuine
   * regression still fails, just a few seconds later.
   */
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // Compiles every route once so per-test assertions never wait on Turbopack.
    { name: "warmup", testMatch: /warmup\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["warmup"],
      testIgnore: /warmup\.setup\.ts/,
    },
  ],

  webServer: {
    command: `pnpm exec next dev -H 127.0.0.1 -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      GROUNDWORK_VAULT: path.resolve(import.meta.dirname, "tests-e2e/fixture-vault"),
      // Its own build dir, so a dev server already open on 4848 does not block the run.
      GROUNDWORK_DIST_DIR: ".next-e2e",
      // Run artefacts stay out of the real .groundwork directory.
      GROUNDWORK_RUNS: path.resolve(import.meta.dirname, ".groundwork-e2e/runs"),
      /*
       * The deterministic engine. Exercising diff review against a real model would be
       * slow, cost tokens and produce different output every run — none of which tests
       * anything about this application. The engine seam exists precisely for this.
       */
      GROUNDWORK_AI_ENGINE: "fixture",
    },
  },
});

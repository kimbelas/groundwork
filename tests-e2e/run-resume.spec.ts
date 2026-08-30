import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Rediscovering a run the page did not start.
 *
 * The bug this pins, reported from real use: *"I switched tab and the status of the
 * synthesize is gone, I don't know now what's happening."*
 *
 * The run outlives the response that started it — deliberately, so closing a tab cannot kill
 * a ten-minute synthesis. The cost was that nothing on a freshly rendered page knew a run was
 * in flight: `pendingRunFor` is `ready`-only by contract, so it returned null, and the panel
 * came back showing enabled buttons over a locked project. The next click failed on the lock
 * for reasons the user could not see.
 *
 * Serial, and it owns `tau-resume` outright. It writes run records into the shared runs root,
 * so a second spec pointed at the same project would find this one's planted runs.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "tau-resume";
const RUNS = path.resolve(import.meta.dirname, "..", ".groundwork-e2e", "runs");
const RUN_ID = "run_20260829_1507";
const RUN_DIR = path.join(RUNS, RUN_ID);

async function writeRecord(patch: Record<string, unknown>): Promise<void> {
  await fsp.mkdir(RUN_DIR, { recursive: true });
  await fsp.writeFile(
    path.join(RUN_DIR, "run.json"),
    JSON.stringify(
      {
        runId: RUN_ID,
        slug: SLUG,
        job: "synthesize",
        status: "running",
        startedAt: new Date(Date.now() - 90_000).toISOString(),
        finishedAt: null,
        ...patch,
      },
      null,
      2,
    ),
    "utf8",
  );
}

test.beforeEach(async () => {
  await fsp.rm(RUN_DIR, { recursive: true, force: true });
});

test.afterAll(async () => {
  await fsp.rm(RUN_DIR, { recursive: true, force: true });
});

test("a page loaded mid-run says so instead of looking idle", async ({ page }) => {
  await writeRecord({});

  await page.goto(`/p/${SLUG}/brief`);

  // The status is server-rendered from the run record, so it survives any navigation —
  // this page never opened a stream and does not need one to know.
  await expect(page.getByTestId("run-status")).toContainText("running");
  await expect(page.getByTestId("run-adopted")).toBeVisible();
});

test("counts elapsed time, so working is distinguishable from hung", async ({ page }) => {
  /*
   * A step list is what this app uses to prove a long run is alive, and an adopted run
   * cannot have one: steps are streamed, never stored, and the stream belongs to the tab
   * that started it. Elapsed time answers the same question, which is why it is here and
   * why a bare spinner would not do.
   */
  await writeRecord({});

  await page.goto(`/p/${SLUG}/brief`);
  await expect(page.getByTestId("run-status")).toContainText(/running · \d+m \d\ds/);
});

test("keeps both buttons disabled while another run holds the lock", async ({ page }) => {
  // Enabled buttons over a locked project is the half of the bug that produced a confusing
  // failure rather than merely a missing status.
  await writeRecord({});

  await page.goto(`/p/${SLUG}/brief`);
  await expect(page.getByTestId("synthesize")).toBeDisabled();
  await expect(page.getByTestId("critique")).toBeDisabled();
});

test("picks up the outcome without a reload, then releases the buttons", async ({ page }) => {
  await writeRecord({});
  await page.goto(`/p/${SLUG}/brief`);
  await expect(page.getByTestId("synthesize")).toBeDisabled();

  // The run ends elsewhere — in the tab that started it, or in no tab at all.
  await writeRecord({ status: "failed", finishedAt: new Date().toISOString() });

  // Polling notices, so the page does not sit disabled until someone thinks to reload.
  await expect(page.getByTestId("run-adopted-failed")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("run-status")).toHaveCount(0);
  await expect(page.getByTestId("synthesize")).toBeEnabled();
});

test("ignores a run belonging to another project", async ({ page }) => {
  // Run ids are timestamps and the runs root is shared across projects, so the record has
  // to be matched on slug and not merely found.
  await writeRecord({ slug: "alpha-portal" });

  await page.goto(`/p/${SLUG}/brief`);
  await expect(page.getByTestId("run-adopted")).toHaveCount(0);
  await expect(page.getByTestId("synthesize")).toBeEnabled();
});

test("ignores a card enhancement, which belongs to the card", async ({ page }) => {
  // A finished card enhancement once surfaced on the brief page as a synthesis. The
  // in-flight lookup must not reintroduce that.
  await writeRecord({ job: "enhance-card", cardId: 1 });

  await page.goto(`/p/${SLUG}/brief`);
  await expect(page.getByTestId("run-adopted")).toHaveCount(0);
});

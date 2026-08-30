import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Suggested answers to open questions.
 *
 * Driven by the fixture engine, which produces three options for the first open question and
 * exactly one for the second. That asymmetry is the point: three is what the prompt asks for
 * and one is what the schema tolerates, and a question with a single option must not render
 * as though something is missing.
 *
 * Serial, and it owns `chi-suggest`: every test here answers questions, which rewrites the
 * fixture's `questions.md`. Reset before each so a failure cannot cascade.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "chi-suggest";
const FILE = path.resolve(import.meta.dirname, "fixture-vault", SLUG, "questions.md");
const RUNS = path.resolve(import.meta.dirname, "..", ".groundwork-e2e", "runs");

const ORIGINAL = `---
questions:
  - id: q1
    text: Does an order exist before money changes hands?
    status: open
    answer: null
    fromRun: run_20260829_1507
    created: 2026-08-29
  - id: q2
    text: Who may set an end time that was never recorded?
    status: open
    answer: null
    fromRun: run_20260829_1507
    created: 2026-08-29
  - id: q3
    text: Is a second shift a second close?
    status: answered
    answer: One close per branch per day.
    fromRun: run_20260829_1507
    created: 2026-08-29
---
`;

/** Runs this spec started, so a later one does not adopt an earlier one's output. */
async function clearRuns(): Promise<void> {
  const entries = await fsp.readdir(RUNS).catch(() => [] as string[]);
  await Promise.all(
    entries.map(async (name) => {
      const record = path.join(RUNS, name, "run.json");
      const raw = await fsp.readFile(record, "utf8").catch(() => null);
      if (raw && raw.includes(`"slug": "${SLUG}"`)) {
        await fsp.rm(path.join(RUNS, name), { recursive: true, force: true });
      }
    }),
  );
}

test.beforeEach(async () => {
  await fsp.writeFile(FILE, ORIGINAL, "utf8");
  await clearRuns();
});

test.afterAll(async () => {
  await fsp.writeFile(FILE, ORIGINAL, "utf8");
  await clearRuns();
});

test("offers three options for a question, and the box stays for a fourth answer", async ({
  page,
}) => {
  // No click. The run starts on arrival, because a question with no options is a question
  // you answer from a blank box - which is the thing this feature removes.
  await page.goto(`/p/${SLUG}/questions`);

  const options = page.getByTestId("options-q1").getByRole("button");
  await expect(options).toHaveCount(3, { timeout: 30_000 });

  // The manual box is the fourth option, and is deliberately not dressed as a card — it was
  // already there, and styling it as one would suggest it is another suggestion.
  await expect(page.getByLabel(/^Answer: Does an order exist/)).toBeVisible();
});

test("a single honest option renders as one, not as something missing", async ({ page }) => {
  await page.goto(`/p/${SLUG}/questions`);

  await expect(page.getByTestId("options-q1").getByRole("button")).toHaveCount(3, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("options-q2").getByRole("button")).toHaveCount(1);
});

test("says whether an option is quoted or inferred", async ({ page }) => {
  /*
   * The distinction that matters most here. The user is about to store one of these as a
   * confirmed fact given to every later run, so an inference must not read as a decision the
   * project already made.
   */
  await page.goto(`/p/${SLUG}/questions`);
  await expect(page.getByTestId("option-q1-0")).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId("option-q1-0")).toContainText("Quoted from the brief");
  await expect(page.getByTestId("option-q1-1")).toContainText("Inferred, not stated");
});

test("choosing an option fills the box rather than committing it", async ({ page }) => {
  await page.goto(`/p/${SLUG}/questions`);
  await expect(page.getByTestId("option-q1-1")).toBeVisible({ timeout: 30_000 });

  const chosen = (await page.getByTestId("option-q1-1").innerText()).split("\n")[0]!;
  await page.getByTestId("option-q1-1").click();

  // Filled, editable, and not yet saved — the last edit before it becomes a fact is the
  // user's, and a one-click store would make a misread option permanent.
  const box = page.getByLabel(/^Answer: Does an order exist/);
  await expect(box).toHaveValue(chosen);
  await expect(page.getByTestId("option-q1-1")).toHaveAttribute("aria-pressed", "true");

  // Still open on disk until Answer is pressed.
  expect(await fsp.readFile(FILE, "utf8")).toContain("status: open");
});

test("the chosen option can be edited before it is saved", async ({ page }) => {
  await page.goto(`/p/${SLUG}/questions`);
  await expect(page.getByTestId("option-q1-0")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("option-q1-0").click();
  const box = page.getByLabel(/^Answer: Does an order exist/);
  await box.fill("Yes, but only for laundry.");
  await page.getByTestId("answer-q1").click();

  await expect(page.getByTestId("answer-text-q1")).toContainText("Yes, but only for laundry.");
  expect(await fsp.readFile(FILE, "utf8")).toContain("Yes, but only for laundry.");
});

test("the options survive leaving the page and coming back", async ({ page }) => {
  /*
   * A finished run's output is on disk, so re-running the model to see it again would be
   * absurd. `pendingRunFor` finds it on the next render — these runs are never marked
   * applied, because there is no apply step; the user clicks an option.
   */
  await page.goto(`/p/${SLUG}/questions`);
  await expect(page.getByTestId("options-q1")).toBeVisible({ timeout: 30_000 });

  await page.goto(`/p/${SLUG}/brief`);
  await page.goto(`/p/${SLUG}/questions`);

  await expect(page.getByTestId("options-q1").getByRole("button")).toHaveCount(3);
});

test("answering by hand still works with no run at all", async ({ page }) => {
  await page.goto(`/p/${SLUG}/questions`);

  await page.getByLabel(/^Answer: Who may set an end time/).fill("An admin, and it is logged.");
  await page.getByTestId("answer-q2").click();

  await expect(page.getByTestId("answer-text-q2")).toContainText("An admin, and it is logged.");
});

test("marks exactly one option as recommended", async ({ page }) => {
  /*
   * One per question. A badge on everything says nothing, and the schema defaults it to
   * `false` for that reason - the model has to choose, or decline to.
   */
  await page.goto(`/p/${SLUG}/questions`);
  await expect(page.getByTestId("options-q1")).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId("options-q1").getByText("Recommended")).toHaveCount(1);
  await expect(page.getByTestId("option-q1-0")).toContainText("Recommended");
  await expect(page.getByTestId("option-q1-1")).not.toContainText("Recommended");
});

test("keeps every option to one short sentence", async ({ page }) => {
  /*
   * The cap is the feature. Three options of four lines each, stacked above the box you
   * answer in, is a wall in front of the thing you came to do - and a suggestion that gets
   * skipped is worth nothing. The schema refuses over 200 characters; this checks what
   * actually renders.
   */
  await page.goto(`/p/${SLUG}/questions`);
  await expect(page.getByTestId("option-q1-0")).toBeVisible({ timeout: 30_000 });

  const first = (await page.getByTestId("option-q1-0").innerText()).split(/\r?\n/)[0]!;
  expect(first.length).toBeLessThanOrEqual(200);
  // One sentence: no full stop other than the one that ends it.
  expect(first.replace(/[.]$/, "").includes(". ")).toBe(false);
});

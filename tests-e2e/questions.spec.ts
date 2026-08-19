import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The Open Questions queue.
 *
 * Answering is the mechanism by which the plan improves, so what matters is that an
 * answer reaches disk intact, that the counts everywhere else follow it, and that a
 * question can be reopened when an answer turns out to be wrong.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "iota-questions";
const ROOT = path.resolve(import.meta.dirname, "fixture-vault", SLUG);
const FILE = path.join(ROOT, "questions.md");

const PROJECT = `---
name: Iota Questions
slug: iota-questions
stage: shaping
health: green
archetype: internal-tool
columns: [Intake, Done]
created: 2026-08-01
updated: 2026-08-01
---

A brief with enough words to keep the empty-brief branch away from this fixture.
`;

const QUESTIONS = `---
questions:
  - id: q1
    text: Who approves the monthly cycle?
    status: open
    answer: null
    fromRun: run_20260801_0900
    created: 2026-08-01
  - id: q2
    text: What exactly breaks in the spreadsheet today?
    status: open
    answer: null
    fromRun: run_20260801_0900
    created: 2026-08-01
  - id: q3
    text: Is IE11 still required?
    status: answered
    answer: No, dropped in January.
    fromRun: run_20260801_0900
    created: 2026-08-01
---

Prose beneath the frontmatter that every write must preserve.
`;

async function reset(): Promise<void> {
  await fsp.mkdir(ROOT, { recursive: true });
  await fsp.writeFile(path.join(ROOT, "project.md"), PROJECT, "utf8");
  await fsp.writeFile(FILE, QUESTIONS, "utf8");
}

test.beforeEach(async () => {
  await reset();
});

test.afterAll(async () => {
  await reset();
});

test("lists open and answered separately", async ({ page }) => {
  await page.goto(`/p/${SLUG}/questions`);

  await expect(page.getByText("Open (2)")).toBeVisible();
  await expect(page.getByText("Answered (1)")).toBeVisible();
  await expect(page.getByTestId("answer-text-q3")).toContainText("dropped in January");
});

test("answering writes to disk and preserves the document body", async ({ page }) => {
  await page.goto(`/p/${SLUG}/questions`);

  await page.getByLabel("Answer: Who approves the monthly cycle?").fill("The ops lead.");
  await page.getByTestId("answer-q1").click();

  await expect(async () => {
    const raw = await fsp.readFile(FILE, "utf8");
    expect(raw).toContain("answer: The ops lead.");
    expect(raw).toContain("status: answered");
  }).toPass({ timeout: 15_000 });

  const raw = await fsp.readFile(FILE, "utf8");
  expect(raw).toContain("Prose beneath the frontmatter");
  // The other questions are untouched.
  expect(raw).toContain("What exactly breaks in the spreadsheet today?");
  expect(raw).toContain("No, dropped in January.");
});

test("the Answer control stays disabled until something is typed", async ({ page }) => {
  await page.goto(`/p/${SLUG}/questions`);
  await expect(page.getByTestId("answer-q1")).toBeDisabled();

  await page.getByLabel("Answer: Who approves the monthly cycle?").fill("x");
  await expect(page.getByTestId("answer-q1")).toBeEnabled();
});

test("answering updates the counts in the tab and the rail", async ({ page }) => {
  await page.goto(`/p/${SLUG}/questions`);

  const tab = page
    .getByRole("navigation", { name: "Project views" })
    .getByRole("link", { name: /Questions/ });
  await expect(tab).toContainText("2");

  await page.getByLabel("Answer: Who approves the monthly cycle?").fill("The ops lead.");
  await page.getByTestId("answer-q1").click();

  await expect(tab).toContainText("1", { timeout: 15_000 });
  await expect(
    page.getByRole("navigation", { name: "Vault" }).getByRole("link", { name: /Iota Questions/ }),
  ).toContainText("1?");
});

test("reopening an answered question returns it to the queue", async ({ page }) => {
  await page.goto(`/p/${SLUG}/questions`);
  await page.getByTestId("reopen-q3").click();

  await expect(page.getByText("Open (3)")).toBeVisible({ timeout: 15_000 });

  await expect(async () => {
    const raw = await fsp.readFile(FILE, "utf8");
    expect(raw).toContain("answer: null");
  }).toPass({ timeout: 15_000 });
});

test("a second answer in the same session succeeds", async ({ page }) => {
  // The baseline has to advance after each write, or the next one 409s.
  await page.goto(`/p/${SLUG}/questions`);

  await page.getByLabel("Answer: Who approves the monthly cycle?").fill("First.");
  await page.getByTestId("answer-q1").click();
  await expect(page.getByTestId("answer-text-q1")).toBeVisible({ timeout: 15_000 });

  await page
    .getByLabel("Answer: What exactly breaks in the spreadsheet today?")
    .fill("Concurrent edits at month end.");
  await page.getByTestId("answer-q2").click();

  await expect(page.getByTestId("answer-text-q2")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("questions-error")).toHaveCount(0);
});

test("a change on disk is refused rather than clobbering", async ({ page }) => {
  await page.goto(`/p/${SLUG}/questions`);

  const external = QUESTIONS.replace("Who approves the monthly cycle?", "EDITED ELSEWHERE");
  await fsp.writeFile(FILE, external, "utf8");

  await page.getByLabel("Answer: Who approves the monthly cycle?").fill("Should not land.");
  await page.getByTestId("answer-q1").click();

  await expect(page.getByTestId("questions-error")).toBeVisible({ timeout: 15_000 });
  expect(await fsp.readFile(FILE, "utf8")).toBe(external);
});

test("a project with no questions says so plainly", async ({ page }) => {
  await page.goto("/p/beta-blank/questions");
  await expect(page.getByText("No open questions")).toBeVisible();
});

test.describe("questions API", () => {
  test("rejects a cross-site write", async ({ request }) => {
    const res = await request.patch("/api/questions", {
      headers: { "sec-fetch-site": "cross-site" },
      data: { slug: SLUG, id: "q1", answer: "x", expectedMtimeMs: 1 },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects an unknown question", async ({ request }) => {
    const mtime = (await (await request.get(`/api/questions?slug=${SLUG}`)).json()).mtimeMs;
    const res = await request.patch("/api/questions", {
      data: { slug: SLUG, id: "nope", answer: "x", expectedMtimeMs: mtime },
    });
    expect(res.status()).toBe(404);
  });

  test("requires the write precondition", async ({ request }) => {
    const res = await request.patch("/api/questions", {
      data: { slug: SLUG, id: "q1", answer: "x" },
    });
    expect(res.status()).toBe(422);
  });
});

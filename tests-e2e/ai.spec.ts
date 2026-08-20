import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The AI planning stage, driven by the deterministic fixture engine.
 *
 * What is being tested is the application's half of the contract: the lock, the
 * streamed progress, schema validation, the grounding check, and that nothing reaches
 * the vault without an explicit accept. The model's half is judged by hand against
 * `fixtures/briefs/`, which no automated test can replace.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "alpha-portal";
const RUNS = path.resolve(import.meta.dirname, "..", ".groundwork-e2e", "runs");
const LOCK = path.resolve(import.meta.dirname, "..", ".groundwork-e2e", "run.lock");

async function clearRuns(): Promise<void> {
  await fsp.rm(RUNS, { recursive: true, force: true });
  await fsp.rm(LOCK, { force: true });
}

test.beforeEach(async () => {
  await clearRuns();
});

test.afterAll(async () => {
  await clearRuns();
});

test("a run streams named steps and produces a proposal", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("synthesize").click();

  // Progress must name what is happening, not just spin.
  await expect(page.getByTestId("run-steps")).toContainText("Reading the brief", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("run-steps")).toContainText("Writing the proposal");

  const review = page.getByTestId("proposal-review");
  await expect(review).toBeVisible({ timeout: 20_000 });
  await expect(review).toContainText("Three phases");
  await expect(review.getByTestId("proposal-card")).toHaveCount(3);
  await expect(review.getByTestId("proposal-question")).toHaveCount(2);
});

test("the grounding check labels each claim", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("synthesize").click();
  await expect(page.getByTestId("proposal-review")).toBeVisible({ timeout: 20_000 });

  const cards = page.getByTestId("proposal-card");

  // One card quotes the brief verbatim, one is honestly marked inferred, and one
  // quotes text the brief does not contain.
  await expect(cards.locator('[data-grounding="quoted"]')).toHaveCount(1);
  await expect(cards.locator('[data-grounding="inferred"]')).toHaveCount(1);
  await expect(cards.locator('[data-grounding="ungrounded"]')).toHaveCount(1);
});

test("an ungrounded claim raises a warning above the diff", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("synthesize").click();
  await expect(page.getByTestId("proposal-review")).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId("proposal-warning").first()).toContainText(
    "quoted text is not in it",
  );
});

test("reviewing writes nothing to the vault", async ({ page }) => {
  const cardsDir = path.resolve(
    import.meta.dirname,
    "fixture-vault",
    SLUG,
    "cards",
  );
  const before = (await fsp.readdir(cardsDir)).sort();
  const projectBefore = await fsp.readFile(
    path.resolve(import.meta.dirname, "fixture-vault", SLUG, "project.md"),
    "utf8",
  );

  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("synthesize").click();
  await expect(page.getByTestId("proposal-review")).toBeVisible({ timeout: 20_000 });

  expect((await fsp.readdir(cardsDir)).sort()).toEqual(before);
  expect(
    await fsp.readFile(
      path.resolve(import.meta.dirname, "fixture-vault", SLUG, "project.md"),
      "utf8",
    ),
  ).toBe(projectBefore);
});

test("the proposal survives the tab closing", async ({ page, context }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("synthesize").click();
  await expect(page.getByTestId("proposal-review")).toBeVisible({ timeout: 20_000 });

  // A brand new page finds the finished run rather than losing it.
  const fresh = await context.newPage();
  await fresh.goto(`/p/${SLUG}/brief`);
  await expect(fresh.getByTestId("proposal-review")).toBeVisible({ timeout: 20_000 });
  await fresh.close();
});

test("critique proposes questions and risks but never cards", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("critique").click();

  const review = page.getByTestId("proposal-review");
  await expect(review).toBeVisible({ timeout: 20_000 });
  await expect(review.getByTestId("proposal-question")).toHaveCount(1);
  await expect(review.getByTestId("proposal-card")).toHaveCount(0);
});

test("synthesize is unavailable while the brief is empty", async ({ page }) => {
  await page.goto("/p/beta-blank/brief");
  await expect(page.getByTestId("synthesize")).toBeDisabled();
  await expect(page.getByText("Write the brief first.")).toBeVisible();
});

test.describe("run API", () => {
  test("refuses a second run while one holds the lock", async ({ request }) => {
    await fsp.mkdir(path.dirname(LOCK), { recursive: true });
    await fsp.writeFile(
      LOCK,
      JSON.stringify({ runId: "run_20260819_0600", startedAt: new Date().toISOString() }),
      "utf8",
    );

    const res = await request.get(`/api/ai/run?job=synthesize&slug=${SLUG}`);
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/already in progress/);

    await fsp.rm(LOCK, { force: true });
  });

  test("rejects an unknown job", async ({ request }) => {
    const res = await request.get(`/api/ai/run?job=destroy&slug=${SLUG}`);
    expect(res.status()).toBe(422);
  });

  test("rejects a traversal slug", async ({ request }) => {
    const res = await request.get("/api/ai/run?job=synthesize&slug=..%2F..%2Fetc");
    expect([400, 422]).toContain(res.status());
  });

  test("rejects enhance-card with no card id", async ({ request }) => {
    const res = await request.get(`/api/ai/run?job=enhance-card&slug=${SLUG}`);
    expect(res.status()).toBe(422);
  });

  test("a malformed proposal is reported with its raw text, never applied", async ({
    request,
  }) => {
    const runId = "run_20260819_0900";
    await fsp.mkdir(path.join(RUNS, runId), { recursive: true });
    await fsp.writeFile(
      path.join(RUNS, runId, "run.json"),
      JSON.stringify({
        runId,
        slug: SLUG,
        job: "synthesize",
        status: "ready",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(RUNS, runId, "proposal.json"),
      '{ "runId": "x", "totally": "wrong" }',
      "utf8",
    );

    const res = await request.get(`/api/ai/proposal?runId=${runId}`);
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.proposal).toBeUndefined();
    expect(body.raw).toContain("totally");
  });
});


// ============================================================
// Apply, snapshot and revert
// ============================================================


const T_SLUG = "theta-apply";
const T_ROOT = path.resolve(import.meta.dirname, "fixture-vault", T_SLUG);
const T_CARDS = path.join(T_ROOT, "cards");

const T_PROJECT = `---
name: Theta Apply
slug: theta-apply
stage: shaping
health: green
archetype: client
columns: [Intake, Shaping, Done]
created: 2026-08-01
updated: 2026-08-01
---

The office keys every request into the work order system by hand, which is slow and
error prone. Tenants should be able to raise a work order themselves and see its status.
`;

const T_QUESTIONS = `---
questions: []
---
`;

async function resetTheta(): Promise<void> {
  await fsp.mkdir(T_CARDS, { recursive: true });
  await fsp.writeFile(path.join(T_ROOT, "project.md"), T_PROJECT, "utf8");
  await fsp.writeFile(path.join(T_ROOT, "questions.md"), T_QUESTIONS, "utf8");
  await fsp.writeFile(path.join(T_ROOT, "roadmap.md"), "---\nphases: []\n---\n", "utf8");
  await fsp.writeFile(path.join(T_ROOT, "risks.md"), "---\nrisks: []\nassumptions: []\n---\n", "utf8");

  for (const name of await fsp.readdir(T_CARDS)) {
    await fsp.rm(path.join(T_CARDS, name), { force: true });
  }
  await fsp.rm(path.join(T_ROOT, ".snapshots"), { recursive: true, force: true });
  await fsp.rm(path.join(T_ROOT, ".trash"), { recursive: true, force: true });
  await fsp.rm(RUNS, { recursive: true, force: true });
  await fsp.rm(LOCK, { force: true });
}

async function thetaCardFiles(): Promise<string[]> {
  return (await fsp.readdir(T_CARDS)).filter((n) => n.endsWith(".md")).sort();
}

async function synthesizeAndReview(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`/p/${T_SLUG}/brief`);
  await page.getByTestId("synthesize").click();
  await expect(page.getByTestId("proposal-review")).toBeVisible({ timeout: 25_000 });
}

test.beforeEach(async () => {
  await resetTheta();
});

test.afterAll(async () => {
  await resetTheta();
});

test("accepting everything writes cards, questions, phases and risks", async ({ page }) => {
  await synthesizeAndReview(page);
  await page.getByTestId("apply").click();

  await expect(page.getByTestId("apply-result")).toBeVisible({ timeout: 20_000 });

  // Three cards proposed, three written.
  expect(await thetaCardFiles()).toHaveLength(3);

  const questions = await fsp.readFile(path.join(T_ROOT, "questions.md"), "utf8");
  expect(questions).toContain("How are users identified today?");
  expect(questions).toContain("status: open");
  expect(questions).toContain("id: q1");

  const roadmap = await fsp.readFile(path.join(T_ROOT, "roadmap.md"), "utf8");
  expect(roadmap).toContain("name: Intake");

  const risks = await fsp.readFile(path.join(T_ROOT, "risks.md"), "utf8");
  expect(risks).toContain("Behaviour parity");
  expect(risks).toContain("id: r1");
});

test("a rejected card leaves no trace", async ({ page }) => {
  await synthesizeAndReview(page);

  // Reject the deliberately ungrounded card.
  const ungrounded = page
    .getByTestId("proposal-card")
    .filter({ has: page.locator('[data-grounding="ungrounded"]') });
  await expect(ungrounded).toHaveCount(1);
  await ungrounded.getByRole("checkbox").uncheck();

  await expect(page.getByTestId("apply")).toContainText("Apply 8 of 9");
  await page.getByTestId("apply").click();
  await expect(page.getByTestId("apply-result")).toBeVisible({ timeout: 20_000 });

  const files = await thetaCardFiles();
  expect(files).toHaveLength(2);

  const bodies = await Promise.all(
    files.map((f) => fsp.readFile(path.join(T_CARDS, f), "utf8")),
  );
  expect(bodies.join("\n")).not.toContain("telemetry");
});

test("selecting none disables apply", async ({ page }) => {
  await synthesizeAndReview(page);
  await page.getByRole("button", { name: "select none" }).click();
  await expect(page.getByTestId("apply")).toBeDisabled();
});

test("acceptance criteria are written as an unticked checklist", async ({ page }) => {
  await synthesizeAndReview(page);
  await page.getByTestId("apply").click();
  await expect(page.getByTestId("apply-result")).toBeVisible({ timeout: 20_000 });

  const files = await thetaCardFiles();
  const first = await fsp.readFile(path.join(T_CARDS, files[0] as string), "utf8");
  expect(first).toContain("## Acceptance criteria");
  expect(first).toContain("- [ ] ");
  expect(first).not.toContain("- [x] ");
});

test("a snapshot is taken before anything is written", async ({ page }) => {
  await synthesizeAndReview(page);
  await page.getByTestId("apply").click();
  await expect(page.getByTestId("apply-result")).toBeVisible({ timeout: 20_000 });

  const snapshots = await fsp.readdir(path.join(T_ROOT, ".snapshots"));
  expect(snapshots.length).toBe(1);

  const manifest = JSON.parse(
    await fsp.readFile(
      path.join(T_ROOT, ".snapshots", snapshots[0] as string, "manifest.json"),
      "utf8",
    ),
  ) as { copied: string[]; created: string[]; runId: string };

  // Side documents existed and were copied; the cards did not and are listed as created.
  expect(manifest.copied).toContain("questions.md");
  expect(manifest.created).toHaveLength(3);
  expect(manifest.runId).toMatch(/^run_/);
});

test("revert returns every touched file to its prior bytes", async ({ page }) => {
  const before = {
    questions: await fsp.readFile(path.join(T_ROOT, "questions.md"), "utf8"),
    roadmap: await fsp.readFile(path.join(T_ROOT, "roadmap.md"), "utf8"),
    risks: await fsp.readFile(path.join(T_ROOT, "risks.md"), "utf8"),
  };

  await synthesizeAndReview(page);
  await page.getByTestId("apply").click();
  await expect(page.getByTestId("apply-result")).toBeVisible({ timeout: 20_000 });
  expect(await thetaCardFiles()).toHaveLength(3);

  await page.getByTestId("revert").click();

  const confirm = page.getByTestId("confirm-revert");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Undo it" }).click();
  await expect(page.getByTestId("revert-result")).toBeVisible({ timeout: 20_000 });

  // Byte-for-byte, not merely equivalent.
  expect(await fsp.readFile(path.join(T_ROOT, "questions.md"), "utf8")).toBe(before.questions);
  expect(await fsp.readFile(path.join(T_ROOT, "roadmap.md"), "utf8")).toBe(before.roadmap);
  expect(await fsp.readFile(path.join(T_ROOT, "risks.md"), "utf8")).toBe(before.risks);

  // Created cards are trashed, not deleted.
  expect(await thetaCardFiles()).toHaveLength(0);
  expect((await fsp.readdir(path.join(T_ROOT, ".trash"))).length).toBe(3);
});

test("the revert control is hidden until there is something to revert", async ({ page }) => {
  await page.goto(`/p/${T_SLUG}/brief`);
  await expect(page.getByTestId("revert")).toHaveCount(0);
});

test.describe("apply API", () => {
  test("refuses to apply the same run twice", async ({ page, request }) => {
    await synthesizeAndReview(page);
    await page.getByTestId("apply").click();
    await expect(page.getByTestId("apply-result")).toBeVisible({ timeout: 20_000 });

    const runId = (await fsp.readdir(RUNS)).sort().pop();
    const res = await request.post("/api/ai/proposal", {
      data: { runId, selection: { cards: [0], phases: [], risks: [], assumptions: [], questions: [] } },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/already been applied/);
  });

  test("rejects a cross-site apply", async ({ request }) => {
    const res = await request.post("/api/ai/proposal", {
      headers: { "sec-fetch-site": "cross-site" },
      data: { runId: "run_20260819_0600", selection: {} },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects an unknown run", async ({ request }) => {
    const res = await request.post("/api/ai/proposal", {
      data: { runId: "run_20990101_0000", selection: {} },
    });
    expect(res.status()).toBe(404);
  });

  test("rejects a malformed run id rather than resolving a path", async ({ request }) => {
    const res = await request.post("/api/ai/proposal", {
      data: { runId: "../../etc", selection: {} },
    });
    expect([400, 422]).toContain(res.status());
  });

  test("revert reports honestly when there is no snapshot", async ({ request }) => {
    const res = await request.post("/api/ai/revert", { data: { slug: T_SLUG } });
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toMatch(/no snapshot/i);
  });
});

// ============================================================
// Enhance one card
// ============================================================

test("enhancing a card goes through the same review and accept path", async ({ page }) => {
  await resetTheta();

  // Give the project a card to enhance.
  await fsp.writeFile(
    path.join(T_CARDS, "0001-existing.md"),
    `---
id: 1
title: Existing card
column: Intake
phase: 1
priority: P3
size: S
confidence: 0.3
blocked: false
order: 100
created: 2026-08-01
updated: 2026-08-01
---

Thin description.
`,
    "utf8",
  );

  await page.goto(`/p/${T_SLUG}/board`);
  await page.getByTestId("card-1").click();
  await expect(page.getByTestId("card-detail")).toBeVisible();

  await page.getByTestId("enhance").click();

  // Same streamed progress and same diff review as synthesis — no shortcut path.
  await expect(page.getByTestId("proposal-review")).toBeVisible({ timeout: 25_000 });
  const cards = page.getByTestId("proposal-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("update");

  // Still nothing written until accepted.
  expect(await fsp.readFile(path.join(T_CARDS, "0001-existing.md"), "utf8")).toContain(
    "Thin description.",
  );

  await page.getByTestId("apply").click();
  await expect(page.getByTestId("apply-result")).toBeVisible({ timeout: 20_000 });

  const raw = await fsp.readFile(path.join(T_CARDS, "0001-existing.md"), "utf8");
  expect(raw).toContain("Expanded by the fixture engine");
  expect(raw).toContain("## Acceptance criteria");
  expect(raw).not.toContain("Thin description.");

  await resetTheta();
});

test("an enhance run is refused while another run holds the lock", async ({ request }) => {
  await fsp.mkdir(path.dirname(LOCK), { recursive: true });
  await fsp.writeFile(
    LOCK,
    JSON.stringify({ runId: "run_20260819_0600", startedAt: new Date().toISOString() }),
    "utf8",
  );

  const res = await request.get(`/api/ai/run?job=enhance-card&slug=${T_SLUG}&cardId=1`);
  expect(res.status()).toBe(409);

  await fsp.rm(LOCK, { force: true });
});

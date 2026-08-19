import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The roadmap track, the decision log, and the risk register.
 *
 * Serial: every test writes the same fixture, and the state is restored before each so
 * one failure cannot cascade.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "kappa-roadmap";
const ROOT = path.resolve(import.meta.dirname, "fixture-vault", SLUG);
const CARDS = path.join(ROOT, "cards");

const PROJECT = `---
name: Kappa Roadmap
slug: kappa-roadmap
stage: building
health: green
archetype: client
columns: [Intake, Build, Done]
created: 2026-08-01
updated: 2026-08-01
---

A brief long enough that the empty-brief branch never applies to this fixture.
`;

const ROADMAP = `---
phases:
  - n: 1
    name: Intake
    goal: Understand what exists before replacing it
  - n: 2
    name: Shaping
    goal: Lock the data model
---
`;

const RISKS = `---
risks:
  - id: r1
    text: The legacy system has no test environment
    likelihood: high
    impact: high
    mitigation: Prove a round-trip against staging first
assumptions:
  - id: a1
    text: A phased cutover is acceptable
    validated: true
  - id: a2
    text: One super per building is stable
    validated: false
---
`;

const LOG = `## 2026-08-14 — Keep the legacy system

**Considered:** replacing it; a sync layer; integrating directly.

**Because:** the client was unambiguous that it is not going away.
`;

function card(id: number, title: string, column: string, phase: number | null): string {
  return `---
id: ${id}
title: ${title}
column: ${column}
phase: ${phase === null ? "null" : phase}
priority: P2
size: M
confidence: 0.5
blocked: false
order: ${id * 100}
created: 2026-08-01
updated: 2026-08-01
---

Body for ${title}.
`;
}

const CARD_FILES: Record<string, string> = {
  "0001-alpha.md": card(1, "Alpha", "Build", 1),
  "0002-bravo.md": card(2, "Bravo", "Done", 1),
  "0003-charlie.md": card(3, "Charlie", "Intake", 2),
  "0004-delta.md": card(4, "Delta", "Intake", null),
};

async function reset(): Promise<void> {
  await fsp.mkdir(CARDS, { recursive: true });
  await fsp.writeFile(path.join(ROOT, "project.md"), PROJECT, "utf8");
  await fsp.writeFile(path.join(ROOT, "roadmap.md"), ROADMAP, "utf8");
  await fsp.writeFile(path.join(ROOT, "risks.md"), RISKS, "utf8");
  await fsp.writeFile(path.join(ROOT, "log.md"), LOG, "utf8");
  for (const [name, contents] of Object.entries(CARD_FILES)) {
    await fsp.writeFile(path.join(CARDS, name), contents, "utf8");
  }
  for (const name of await fsp.readdir(CARDS)) {
    if (!(name in CARD_FILES)) await fsp.rm(path.join(CARDS, name), { force: true });
  }
}

test.beforeEach(async () => {
  await reset();
});

test.afterAll(async () => {
  await reset();
});

test.describe("roadmap", () => {
  test("renders a lane per phase with done/total counts", async ({ page }) => {
    await page.goto(`/p/${SLUG}/roadmap`);

    await expect(page.getByRole("region", { name: "Intake" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Shaping" })).toBeVisible();

    // Phase 1 has Alpha (Build) and Bravo (Done) -> 1 of 2 done.
    await expect(page.getByTestId("phase-count-p1")).toHaveText("1/2");
    await expect(page.getByTestId("phase-count-p2")).toHaveText("0/1");
  });

  test("shows each phase goal", async ({ page }) => {
    await page.goto(`/p/${SLUG}/roadmap`);
    await expect(page.getByText("Understand what exists before replacing it")).toBeVisible();
  });

  test("collects cards with no phase into their own lane", async ({ page }) => {
    await page.goto(`/p/${SLUG}/roadmap`);
    const lane = page.getByRole("region", { name: "Unphased" });
    await expect(lane).toBeVisible();
    await expect(lane.getByTestId("phase-card-4")).toContainText("Delta");
  });

  test("a card carries its board column onto the track", async ({ page }) => {
    // Phase and column are independent axes; the track must show both.
    await page.goto(`/p/${SLUG}/roadmap`);
    await expect(page.getByTestId("phase-card-1")).toContainText("Build");
  });

  test("changing a card's phase in the detail pane moves it on the track", async ({ page }) => {
    await page.goto(`/p/${SLUG}/board`);
    await page.getByTestId("card-4").click();
    await page.getByTestId("card-detail").getByLabel("Phase").selectOption("2");

    await expect(async () => {
      expect(await fsp.readFile(path.join(CARDS, "0004-delta.md"), "utf8")).toContain("phase: 2");
    }).toPass({ timeout: 15_000 });

    await page.goto(`/p/${SLUG}/roadmap`);
    await expect(page.getByRole("region", { name: "Shaping" }).getByTestId("phase-card-4")).toBeVisible();
    await expect(page.getByRole("region", { name: "Unphased" })).toHaveCount(0);
  });

  test("a project with no phases says so", async ({ page }) => {
    await page.goto("/p/beta-blank/roadmap");
    await expect(page.getByText("No phases yet")).toBeVisible();
  });
});

test.describe("decision log", () => {
  test("lists existing entries newest first", async ({ page }) => {
    await page.goto(`/p/${SLUG}/log`);
    await expect(page.getByText("Keep the legacy system")).toBeVisible();
    await expect(page.getByText("2026-08-14")).toBeVisible();
    await expect(page.getByText(/Considered:.*replacing it/)).toBeVisible();
  });

  test("recording a decision prepends it to the file", async ({ page }) => {
    await page.goto(`/p/${SLUG}/log`);
    await page.getByTestId("add-decision").click();

    await page.getByLabel("What was decided").fill("Ship behind a flag");
    await page.getByLabel("What else was considered").fill("a long-lived branch");
    await page.getByLabel("Why").fill("the branch would diverge for weeks");
    await page.getByRole("button", { name: "Record" }).click();

    await expect(async () => {
      const raw = await fsp.readFile(path.join(ROOT, "log.md"), "utf8");
      expect(raw).toContain("Ship behind a flag");
    }).toPass({ timeout: 15_000 });

    const raw = await fsp.readFile(path.join(ROOT, "log.md"), "utf8");
    // Newest on top, and the existing entry survives untouched.
    expect(raw.indexOf("Ship behind a flag")).toBeLessThan(raw.indexOf("Keep the legacy system"));
    expect(raw).toContain("**Considered:** a long-lived branch");
    expect(raw).toContain("the client was unambiguous");
  });

  test("the entry is dated by the server, not the browser", async ({ page }) => {
    await page.goto(`/p/${SLUG}/log`);
    await page.getByTestId("add-decision").click();
    await page.getByLabel("What was decided").fill("Dated today");
    await page.getByRole("button", { name: "Record" }).click();

    const today = new Date().toISOString().slice(0, 10);
    await expect(async () => {
      expect(await fsp.readFile(path.join(ROOT, "log.md"), "utf8")).toContain(`## ${today} —`);
    }).toPass({ timeout: 15_000 });
  });

  test("Record stays disabled with no title", async ({ page }) => {
    await page.goto(`/p/${SLUG}/log`);
    await page.getByTestId("add-decision").click();
    await expect(page.getByRole("button", { name: "Record" })).toBeDisabled();
  });

  test("a project with no log says so", async ({ page }) => {
    await page.goto("/p/beta-blank/log");
    await expect(page.getByText("Nothing recorded yet")).toBeVisible();
  });
});

test.describe("risk register", () => {
  test("shows risks with likelihood and impact", async ({ page }) => {
    await page.goto(`/p/${SLUG}/log`);
    const risk = page.getByTestId("risk-r1");
    await expect(risk).toContainText("no test environment");
    await expect(risk).toContainText("high/high");
    await expect(risk).toContainText("Prove a round-trip");
  });

  test("distinguishes validated from unvalidated assumptions", async ({ page }) => {
    await page.goto(`/p/${SLUG}/log`);
    await expect(page.getByTestId("assumption-a1")).toHaveAttribute("data-validated", "true");
    await expect(page.getByTestId("assumption-a2")).toHaveAttribute("data-validated", "false");
    await expect(page.getByText("2, 1 unvalidated")).toBeVisible();
  });

  test("validating an assumption writes to the file", async ({ page }) => {
    await page.goto(`/p/${SLUG}/log`);
    await page.getByLabel("Validated: One super per building is stable").check();

    await expect(async () => {
      const raw = await fsp.readFile(path.join(ROOT, "risks.md"), "utf8");
      expect(raw).toMatch(/id: a2[\s\S]*validated: true/);
    }).toPass({ timeout: 15_000 });

    // The risk list and the other assumption are untouched.
    const raw = await fsp.readFile(path.join(ROOT, "risks.md"), "utf8");
    expect(raw).toContain("no test environment");
    expect(raw).toMatch(/id: a1[\s\S]*validated: true/);
  });

  test("a second toggle in the same session succeeds", async ({ page }) => {
    await page.goto(`/p/${SLUG}/log`);
    await page.getByLabel("Validated: One super per building is stable").check();
    await expect(page.getByTestId("assumption-a2")).toHaveAttribute("data-validated", "true", {
      timeout: 15_000,
    });

    await page.getByLabel("Validated: A phased cutover is acceptable").uncheck();
    await expect(page.getByTestId("assumption-a1")).toHaveAttribute("data-validated", "false", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("risks-error")).toHaveCount(0);
  });

  test("a change on disk is refused rather than clobbering", async ({ page }) => {
    await page.goto(`/p/${SLUG}/log`);

    const external = RISKS.replace("One super per building is stable", "EDITED ELSEWHERE");
    await fsp.writeFile(path.join(ROOT, "risks.md"), external, "utf8");

    // click(), not check(): check() asserts the box ends up checked, and the whole
    // point here is that the conflict rolls the optimistic update back.
    await page.getByLabel("Validated: One super per building is stable").click();

    await expect(page.getByTestId("risks-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("assumption-a2")).toHaveAttribute("data-validated", "false");
    expect(await fsp.readFile(path.join(ROOT, "risks.md"), "utf8")).toBe(external);
  });
});

test.describe("log and risks API", () => {
  test("rejects a cross-site decision", async ({ request }) => {
    const res = await request.post("/api/log", {
      headers: { "sec-fetch-site": "cross-site" },
      data: { slug: SLUG, title: "csrf" },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects a cross-site assumption toggle", async ({ request }) => {
    const res = await request.patch("/api/risks", {
      headers: { "sec-fetch-site": "cross-site" },
      data: { slug: SLUG, id: "a1", validated: false, expectedMtimeMs: 1 },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects an unknown assumption", async ({ request }) => {
    const mtime = (await (await request.get(`/api/risks?slug=${SLUG}`)).json()).mtimeMs;
    const res = await request.patch("/api/risks", {
      data: { slug: SLUG, id: "nope", validated: true, expectedMtimeMs: mtime },
    });
    expect(res.status()).toBe(404);
  });

  test("rejects a traversal slug on the log", async ({ request }) => {
    const res = await request.post("/api/log", {
      data: { slug: "../../etc", title: "nope" },
    });
    expect([400, 422]).toContain(res.status());
  });
});

test("a card in a phase the roadmap does not declare still gets a lane", async ({ page }) => {
  // alpha-portal has cards on phase 1 but no roadmap.md at all. Without data-driven
  // lanes those cards would be present on the board and invisible here.
  await page.goto("/p/alpha-portal/roadmap");
  await expect(page.getByTestId("phase-track")).toBeVisible();
  await expect(page.getByRole("region", { name: "Phase 1" })).toBeVisible();
});

test("log prose renders emphasis instead of literal asterisks", async ({ page }) => {
  await page.goto(`/p/${SLUG}/log`);

  // "**Considered:**" must arrive as a <strong>, not as four asterisks on screen.
  const entry = page.getByTestId("decision-log");
  await expect(entry.getByText("Considered:", { exact: true }).first()).toBeVisible();
  await expect(entry).not.toContainText("**Considered:**");
});

test("markup in vault prose is shown literally, never as HTML", async ({ page }) => {
  // A log entry can come from an accepted AI proposal, so this path must not render
  // markup. The text is displayed; no element is created from it.
  await fsp.writeFile(
    path.join(ROOT, "log.md"),
    "## 2026-08-19 — Injection probe\n\nA <b>bold</b> tag and <script>alert(1)</script>.\n",
    "utf8",
  );

  await page.goto(`/p/${SLUG}/log`);
  const entry = page.getByTestId("decision-log");
  await expect(entry).toContainText("<b>bold</b>");
  await expect(entry).toContainText("<script>alert(1)</script>");
  expect(await entry.locator("b").count()).toBe(0);
  expect(await entry.locator("script").count()).toBe(0);
});

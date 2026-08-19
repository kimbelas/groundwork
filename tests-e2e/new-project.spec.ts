import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Creating a project.
 *
 * Serial, and every test cleans up after itself: these write real folders into the
 * fixture vault, which every other spec reads through the rail in the root layout.
 */
test.describe.configure({ mode: "serial" });

const VAULT = path.resolve(import.meta.dirname, "fixture-vault");
const CREATED = ["lambda-fresh", "mu-typo-check", "duplicate-name"];

async function cleanup(): Promise<void> {
  for (const slug of CREATED) {
    await fsp.rm(path.join(VAULT, slug), { recursive: true, force: true });
  }
}

test.beforeEach(async () => {
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
});

test("creating a project writes a vault folder and opens its brief", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-project").click();

  await page.getByLabel("Project name").fill("Lambda Fresh");
  await page.getByLabel("Kind of project").selectOption("client");
  await page.getByRole("button", { name: "Create project" }).click();

  // Lands straight in the brief, the only useful next step for an empty project.
  await expect(page).toHaveURL(/\/p\/lambda-fresh\/brief$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Lambda Fresh" })).toBeVisible();

  const raw = await fsp.readFile(path.join(VAULT, "lambda-fresh", "project.md"), "utf8");
  expect(raw).toContain("name: Lambda Fresh");
  expect(raw).toContain("slug: lambda-fresh");
  expect(raw).toContain("archetype: client");
  expect(raw).toContain("stage: idea");
});

test("the scaffolded project is indistinguishable from a hand-written one", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByLabel("Project name").fill("Lambda Fresh");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/lambda-fresh/, { timeout: 20_000 });

  const dir = path.join(VAULT, "lambda-fresh");
  for (const f of ["project.md", "roadmap.md", "questions.md", "risks.md", "log.md"]) {
    await expect(fsp.access(path.join(dir, f))).resolves.toBeUndefined();
  }
  const entries = await fsp.readdir(dir);
  expect(entries).toContain("cards");
});

test("the slug is shown before committing to it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-project").click();

  // The slug becomes an immutable folder name, so it has to be visible up front.
  await page.getByLabel("Project name").fill("Mu Typo Check!!");
  await expect(page.getByTestId("slug-preview")).toContainText("vault/mu-typo-check");
});

test("Create stays disabled until there is a usable name", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await expect(page.getByRole("button", { name: "Create project" })).toBeDisabled();

  await page.getByLabel("Project name").fill("Lambda Fresh");
  await expect(page.getByRole("button", { name: "Create project" })).toBeEnabled();
});

test("a duplicate name is refused rather than merging into the existing project", async ({
  page,
}) => {
  await fsp.mkdir(path.join(VAULT, "duplicate-name"), { recursive: true });
  await fsp.writeFile(
    path.join(VAULT, "duplicate-name", "project.md"),
    "---\nname: Duplicate Name\n---\n\nAlready here.\n",
    "utf8",
  );

  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByLabel("Project name").fill("Duplicate Name");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByTestId("new-project-error")).toContainText(/already exists/i, {
    timeout: 20_000,
  });

  // The existing project's content is untouched.
  expect(await fsp.readFile(path.join(VAULT, "duplicate-name", "project.md"), "utf8")).toContain(
    "Already here.",
  );
});

test("cancel closes the form without creating anything", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByLabel("Project name").fill("Lambda Fresh");
  await page.getByRole("button", { name: "cancel" }).click();

  await expect(page.getByTestId("new-project-form")).toHaveCount(0);
  await expect(fsp.access(path.join(VAULT, "lambda-fresh"))).rejects.toThrow();
});

test.describe("create API", () => {
  test("rejects a cross-site create", async ({ request }) => {
    const res = await request.post("/api/vault", {
      headers: { "sec-fetch-site": "cross-site" },
      data: { name: "Csrf Project", archetype: "client" },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects a traversal slug", async ({ request }) => {
    const res = await request.post("/api/vault", {
      data: { name: "Escape", slug: "../../etc", archetype: "client" },
    });
    expect([400, 422]).toContain(res.status());
  });

  test("rejects an unknown archetype", async ({ request }) => {
    const res = await request.post("/api/vault", {
      data: { name: "Bad Kind", archetype: "not-a-kind" },
    });
    expect(res.status()).toBe(422);
  });

  test("rejects a Windows reserved device name as a slug", async ({ request }) => {
    const res = await request.post("/api/vault", {
      data: { name: "Nul", slug: "nul", archetype: "client" },
    });
    expect(res.status()).toBe(400);
  });

  test("lists projects", async ({ request }) => {
    const res = await request.get("/api/vault");
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { projects: { slug: string }[] };
    expect(body.projects.map((p) => p.slug)).toContain("alpha-portal");
  });
});

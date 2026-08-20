import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Connecting a repository to a project.
 *
 * Serial because every test here writes the same fixture project, which is reset before
 * each one so a failure cannot cascade.
 *
 * The repo directories are created in the OS temp dir, never inside the checkout: a
 * fixture repo under `tests-e2e/` would sit inside the app root, and half of what these
 * tests check is behaviour that only applies outside it.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "zeta-editable";
const FILE = path.resolve(import.meta.dirname, "fixture-vault", SLUG, "project.md");
const VAULT = path.resolve(import.meta.dirname, "fixture-vault");

const ORIGINAL = `---
name: Zeta Editable
slug: zeta-editable
stage: shaping
health: green
archetype: internal-tool
columns: [Intake, Build, Done]
created: 2026-08-15
updated: 2026-08-15
---

ORIGINAL BODY MARKER
`;

let scratch: string;
let repoDir: string;

test.beforeAll(async () => {
  scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-e2e-repo-"));
  repoDir = path.join(scratch, "sample-repo");
  await fsp.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fsp.writeFile(path.join(repoDir, "src", "index.ts"), "export const x = 1;\n", "utf8");
});

test.afterAll(async () => {
  await fsp.rm(scratch, { recursive: true, force: true });
  await fsp.writeFile(FILE, ORIGINAL, "utf8");
});

test.beforeEach(async () => {
  await fsp.writeFile(FILE, ORIGINAL, "utf8");
});

/**
 * The panel's own alert.
 *
 * Scoped, not `page.getByRole("alert")`: the brief page also renders an empty live region
 * for autosave status, so an unscoped query is a strict-mode violation that fails on a
 * detail unrelated to what is being tested.
 */
function repoAlert(page: import("@playwright/test").Page) {
  return page.getByTestId("repo-panel").getByRole("alert");
}

async function frontmatter(): Promise<string> {
  return fsp.readFile(FILE, "utf8");
}

test("offers a connect field when no repo is linked", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);

  const panel = page.getByTestId("repo-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("repo-path")).toBeVisible();
  await expect(page.getByTestId("repo-connected")).toHaveCount(0);
});

test("connects a repository and shows it", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);

  await page.getByTestId("repo-path").fill(repoDir);
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByTestId("repo-connected")).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  // Written to the vault, not only to the screen.
  expect(await frontmatter()).toContain("repo:");
});

test("writes the repo without disturbing the brief body", async ({ page }) => {
  // A frontmatter edit leaves the body bytes alone. Same contract as every other write.
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("repo-path").fill(repoDir);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("repo-connected")).toBeVisible();

  expect(await frontmatter()).toContain("ORIGINAL BODY MARKER");
});

test("survives a reload, because the connection lives in the file", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("repo-path").fill(repoDir);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("repo-connected")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("repo-connected")).toBeVisible();
});

test("disconnects", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("repo-path").fill(repoDir);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("repo-connected")).toBeVisible();

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByTestId("repo-path")).toBeVisible();
  expect(await frontmatter()).not.toContain("repo:");
});

test("refuses a relative path, with a reason", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);

  await page.getByTestId("repo-path").fill("../some-repo");
  await page.getByRole("button", { name: "Connect" }).click();

  // The message has to say what is wrong. "Invalid path" would leave the user guessing
  // at a rule they have no way to know.
  await expect(repoAlert(page)).toContainText("absolute");
  expect(await frontmatter()).not.toContain("repo:");
});

test("refuses a directory that does not exist", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);

  await page.getByTestId("repo-path").fill(path.join(scratch, "not-here"));
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(repoAlert(page)).toBeVisible();
  expect(await frontmatter()).not.toContain("repo:");
});

test("refuses the vault itself", async ({ page }) => {
  /*
   * The vault holds plans and a repo holds code. Connecting one to the other would let
   * repo-grounded planning quote its own notes as source, which is exactly the confusion
   * the grounding check exists to prevent.
   */
  await page.goto(`/p/${SLUG}/brief`);

  await page.getByTestId("repo-path").fill(VAULT);
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(repoAlert(page)).toContainText("vault");
  expect(await frontmatter()).not.toContain("repo:");
});

test("reports a repo that has gone away, instead of hiding it", async ({ page }) => {
  // A connected directory can be renamed or unplugged at any time. The link is kept so
  // the user can fix it; dropping it silently would lose a decision they made.
  const doomed = path.join(scratch, "doomed-repo");
  await fsp.mkdir(doomed, { recursive: true });

  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("repo-path").fill(doomed);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("repo-connected")).toBeVisible();

  await fsp.rm(doomed, { recursive: true, force: true });
  await page.reload();

  await expect(page.getByText("Not found", { exact: true })).toBeVisible();
  await expect(page.getByTestId("repo-connected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
});

test("the connect field carries an accessible name", async ({ page }) => {
  // A placeholder is not a label. It disappears the moment anyone types.
  await page.goto(`/p/${SLUG}/brief`);
  await expect(page.getByLabel("Repository path")).toBeVisible();
});

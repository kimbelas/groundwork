import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Exporting a plan into a real folder on disk.
 *
 * Serial, and on its own fixture project: `pi-exportable` belongs to this file only. Two
 * specs sharing a project both reset it in `beforeEach`, and with two workers they
 * co-schedule and reset it under each other — which surfaces as a phantom conflict rather
 * than as the test-isolation bug it is.
 *
 * The target is a fresh OS temp directory per test. Never the checkout: export refuses this
 * app's own root, so exporting inside it would exercise the refusal rather than the feature,
 * and exporting into a subdirectory of it would leave files in the repo when a run is killed.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "pi-exportable";

let scratch: string;
let target: string;

test.beforeEach(async () => {
  scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-e2e-export-"));
  target = path.join(scratch, "the-project");
  await fsp.mkdir(target, { recursive: true });
});

test.afterEach(async () => {
  await fsp.rm(scratch, { recursive: true, force: true });
});

/** The path as a user would type it into the field. */
function typed(dir: string): string {
  return dir.split(path.sep).join("/");
}

test("previews first, writes nothing, then writes both files", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);

  await page.getByTestId("export-open").click();
  const drawer = page.getByTestId("export-drawer");
  await expect(drawer).toBeVisible();

  await drawer.getByTestId("export-target").fill(typed(target));
  await drawer.getByRole("button", { name: "Preview" }).click();

  const preview = drawer.getByTestId("export-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId("export-file")).toHaveCount(2);
  await expect(preview).toContainText("CLAUDE.md");
  await expect(preview).toContainText("TASKS.md");
  await expect(preview.getByText("new file").first()).toBeVisible();

  // A preview is a read. Nothing on disk yet.
  expect(await fsp.readdir(target)).toEqual([]);

  await drawer.getByTestId("export-write").click();

  // The result stays on screen with the drawer open: closing the pane in the success
  // handler would destroy the only report of what happened and where.
  await expect(drawer.getByTestId("export-result")).toBeVisible();
  await expect(drawer.getByTestId("export-result")).toContainText(target.split(path.sep).pop()!);

  expect((await fsp.readdir(target)).sort()).toEqual(["CLAUDE.md", "TASKS.md"]);

  const claude = await fsp.readFile(path.join(target, "CLAUDE.md"), "utf8");
  expect(claude).toContain("Pi Exportable");
  // The brief verbatim, not a summary of it.
  expect(claude).toContain("PI BRIEF MARKER");
  // Open questions travel as questions, so an agent asks instead of inventing.
  expect(claude).toContain("Who signs off on scope changes once building starts?");
  // Words, not codes.
  expect(claude).toContain("High");
  expect(claude).not.toMatch(/\bP1\b/);

  const tasks = await fsp.readFile(path.join(target, "TASKS.md"), "utf8");
  expect(tasks).toContain("- [ ] Trace the current intake process");
  // A card in Done is already ticked.
  expect(tasks).toContain("- [x] Pin the SOAP contract");
  expect(tasks.indexOf("Phase 1")).toBeLessThan(tasks.indexOf("Phase 2"));
});

test("shows what an overwrite would destroy, and asks", async ({ page }) => {
  await fsp.writeFile(
    path.join(target, "CLAUDE.md"),
    "# Someone else's instructions\n\nDO NOT LOSE THIS LINE\n",
    "utf8",
  );

  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("export-open").click();

  const drawer = page.getByTestId("export-drawer");
  await drawer.getByTestId("export-target").fill(typed(target));
  await drawer.getByRole("button", { name: "Preview" }).click();

  // The preview names the clash and shows the contents at risk — this is the thing the
  // decision is about, and a prompt that cannot show it gets clicked through.
  const preview = drawer.getByTestId("export-preview");
  await expect(preview.getByText("would replace")).toBeVisible();
  await expect(preview).toContainText("DO NOT LOSE THIS LINE");

  await drawer.getByTestId("export-write").click();

  // A destructive question is a modal, not a drawer.
  const confirm = page.getByTestId("export-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("CLAUDE.md");

  // Cancelling writes nothing and leaves the file alone.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect(await fsp.readFile(path.join(target, "CLAUDE.md"), "utf8")).toContain(
    "DO NOT LOSE THIS LINE",
  );

  // Confirming replaces it.
  await drawer.getByTestId("export-write").click();
  await page.getByTestId("export-confirm").getByRole("button", { name: "Replace" }).click();

  await expect(drawer.getByTestId("export-result")).toContainText("Replaced CLAUDE.md");
  const after = await fsp.readFile(path.join(target, "CLAUDE.md"), "utf8");
  expect(after).toContain("Pi Exportable");
  expect(after).not.toContain("DO NOT LOSE THIS LINE");
});

test("Escape closes the confirmation and leaves the drawer open", async ({ page }) => {
  // The fourth bug of this shape in this codebase was two layers closing on one Escape.
  await fsp.writeFile(path.join(target, "TASKS.md"), "old tasks\n", "utf8");

  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("export-open").click();

  const drawer = page.getByTestId("export-drawer");
  await drawer.getByTestId("export-target").fill(typed(target));
  await drawer.getByRole("button", { name: "Preview" }).click();
  await expect(drawer.getByTestId("export-preview")).toBeVisible();

  await drawer.getByTestId("export-write").click();
  await expect(page.getByTestId("export-confirm")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("export-confirm")).toBeHidden();
  await expect(drawer).toBeVisible();

  expect(await fsp.readFile(path.join(target, "TASKS.md"), "utf8")).toBe("old tasks\n");
});

test("refuses a file that appeared between the preview and the write", async ({ page }) => {
  /*
   * The gap between showing and clobbering, through the UI.
   *
   * The user previews an empty folder, sees "new file" twice, and clicks write — but by then
   * something has created a CLAUDE.md. Without a precondition their "nothing to overwrite"
   * decision destroys a file they were never shown.
   */
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("export-open").click();

  const drawer = page.getByTestId("export-drawer");
  await drawer.getByTestId("export-target").fill(typed(target));
  await drawer.getByRole("button", { name: "Preview" }).click();
  await expect(drawer.getByTestId("export-preview")).toBeVisible();
  await expect(drawer.getByText("new file").first()).toBeVisible();

  await fsp.writeFile(path.join(target, "CLAUDE.md"), "APPEARED IN THE GAP\n", "utf8");

  // No confirmation dialog: this browser has nothing to confirm, which is the point.
  await drawer.getByTestId("export-write").click();

  await expect(drawer.getByTestId("export-error")).toContainText("Preview again");
  await expect(page.getByTestId("export-confirm")).toHaveCount(0);
  expect(await fsp.readFile(path.join(target, "CLAUDE.md"), "utf8")).toBe("APPEARED IN THE GAP\n");
  // Not half an export either: the refusal stopped both files.
  expect(await fsp.readdir(target)).toEqual(["CLAUDE.md"]);

  // Previewing again shows the clash, and then it can be replaced deliberately.
  await drawer.getByRole("button", { name: "Preview" }).click();
  await expect(drawer.getByTestId("export-preview").getByText("would replace")).toBeVisible();
  await drawer.getByTestId("export-write").click();
  await page.getByTestId("export-confirm").getByRole("button", { name: "Replace" }).click();
  await expect(drawer.getByTestId("export-result")).toContainText("Replaced CLAUDE.md");
});

test("refuses a folder that does not exist, and does not create it", async ({ page }) => {
  const missing = path.join(scratch, "not-here", "deeper");

  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("export-open").click();

  const drawer = page.getByTestId("export-drawer");
  await drawer.getByTestId("export-target").fill(typed(missing));
  await drawer.getByRole("button", { name: "Preview" }).click();

  await expect(drawer.getByTestId("export-error")).toContainText("No folder at");
  // A typo must fail rather than scatter files somewhere nobody meant.
  await expect(fsp.stat(path.join(scratch, "not-here"))).rejects.toThrow();
});

test("refuses to export into the vault", async ({ page }) => {
  const vault = path.resolve(import.meta.dirname, "fixture-vault");

  await page.goto(`/p/${SLUG}/brief`);
  await page.getByTestId("export-open").click();

  const drawer = page.getByTestId("export-drawer");
  await drawer.getByTestId("export-target").fill(typed(path.join(vault, SLUG)));
  await drawer.getByRole("button", { name: "Preview" }).click();

  // A generated file inside the data tree would be read back as part of the plan it came
  // from, and would bypass every precondition lib/vault.ts exists to enforce.
  await expect(drawer.getByTestId("export-error")).toContainText("inside the vault");
  expect(await fsp.readdir(path.join(vault, SLUG))).not.toContain("CLAUDE.md");
});

test("the export API refuses a cross-site request", async ({ request }) => {
  // Mutating, so it carries the loopback + Sec-Fetch-Site + Origin guards. No auth does
  // not mean no boundary: a page in the browser can reach 127.0.0.1.
  const res = await request.post("/api/export", {
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    data: { slug: SLUG, target: typed(target), confirm: true },
  });

  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(await fsp.readdir(target)).toEqual([]);
});

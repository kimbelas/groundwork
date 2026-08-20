import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Building and clearing the repository index, through the UI.
 *
 * Serial: every test writes the same fixture project, reset before each so a failure cannot
 * cascade. The project is this file's own — sharing one with another spec is how two specs
 * end up resetting a file under each other, which reads as a lost-update bug.
 *
 * The repo lives in the OS temp dir, never in the checkout: connecting a directory inside
 * the app root would exercise a different path than the one users take.
 *
 * These tests do NOT assume the embedding model is present. A build on a machine without it
 * produces a keyword-only index, which is a supported outcome — so every assertion here is
 * about work being done and reported, not about semantic search specifically.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "xi-indexed";
const FILE = path.resolve(import.meta.dirname, "fixture-vault", SLUG, "project.md");

let scratch: string;
let repoDir: string;

function frontmatter(repo: string | null): string {
  const lines = [
    "---",
    "name: Xi Indexed",
    "slug: xi-indexed",
    "stage: shaping",
    "health: green",
    "archetype: internal-tool",
    "columns: [Backlog, In progress, Done]",
    ...(repo ? [`repo: '${repo}'`] : []),
    "created: 2026-08-20",
    "updated: 2026-08-20",
    "---",
    "",
    "XI BODY MARKER",
    "",
  ];
  return lines.join("\n");
}

test.beforeAll(async () => {
  scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-e2e-index-"));
  repoDir = path.join(scratch, "sample-repo");

  await fsp.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fsp.writeFile(
    path.join(repoDir, "src", "writer.ts"),
    [
      "/** Every write carries expectedMtimeMs. */",
      "export async function writeDocument(target: string, body: string, expectedMtimeMs: number) {",
      "  const current = await statFile(target);",
      "  if (current.mtimeMs !== expectedMtimeMs) throw new ConflictError('changed on disk');",
      "  return atomicWrite(target, body);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    path.join(repoDir, "README.md"),
    "# Sample repo\n\nUsed by the index e2e tests.\n",
    "utf8",
  );
  // Not indexable: proves the skip path runs against a real tree, not only in unit tests.
  await fsp.writeFile(path.join(repoDir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

test.afterAll(async () => {
  await fsp.rm(scratch, { recursive: true, force: true });
  await fsp.writeFile(FILE, frontmatter(null), "utf8");
});

test.beforeEach(async () => {
  // Connected up front, by writing the file. The connect flow itself is repo.spec's job.
  await fsp.writeFile(FILE, frontmatter(repoDir.split(path.sep).join("/")), "utf8");
});

test("the index panel appears only once a repo is connected", async ({ page }) => {
  await fsp.writeFile(FILE, frontmatter(null), "utf8");
  await page.goto(`/p/${SLUG}/brief`);

  await expect(page.getByTestId("repo-panel")).toBeVisible();
  await expect(page.getByTestId("index-panel")).toHaveCount(0);
});

test("offers to build when a repo is connected but nothing is indexed", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);

  await expect(page.getByTestId("index-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "Build index" })).toBeVisible();
  await expect(page.getByTestId("index-summary")).toHaveCount(0);
});

test("previews the work before committing to it", async ({ page }) => {
  // The whole point of a two-step control: embedding is the one slow operation here, and a
  // button that silently starts one looks broken.
  await page.goto(`/p/${SLUG}/brief`);

  await page.getByRole("button", { name: "Check for changes" }).click();
  const preview = page.getByTestId("index-preview");

  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview).toContainText("chunks to embed");
});

test("builds the index and reports what it contains", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);

  await page.getByRole("button", { name: "Build index" }).click();

  // Generous: a first build loads the embedding model, which is a large one-off cost.
  const summary = page.getByTestId("index-summary");
  await expect(summary).toBeVisible({ timeout: 240_000 });
  await expect(summary).toContainText("chunks from");

  // The button reflects that an index now exists.
  await expect(page.getByRole("button", { name: "Update index" })).toBeVisible();
});

test("a second check finds nothing to do", async ({ page }) => {
  /*
   * The incremental property, end to end. Nothing changed in the repo between the build
   * above and this check, so there is no work — which is the entire reason the index layer
   * hashes files rather than re-embedding everything.
   */
  await page.goto(`/p/${SLUG}/brief`);

  await page.getByRole("button", { name: "Check for changes" }).click();
  await expect(page.getByTestId("index-preview")).toContainText("up to date", {
    timeout: 30_000,
  });
});

test("an edit in the repo shows up as work to do", async ({ page }) => {
  await fsp.writeFile(
    path.join(repoDir, "src", "extra.ts"),
    "export const added = true;\n",
    "utf8",
  );

  await page.goto(`/p/${SLUG}/brief`);
  await page.getByRole("button", { name: "Check for changes" }).click();

  /*
   * A "reused" count in the preview is what shows the unchanged files were not re-embedded.
   * Without it this assertion would pass on a full rebuild, which is the behaviour the
   * incremental layer exists to avoid.
   */
  const preview = page.getByTestId("index-preview");
  await expect(preview).toContainText("chunks to embed", { timeout: 30_000 });
  await expect(preview).toContainText("reused");

  await fsp.rm(path.join(repoDir, "src", "extra.ts"));
});

test("clears the index, and offers to build again", async ({ page }) => {
  // Derived data: clearing is always safe, and rebuilding is the fix for anything wrong.
  await page.goto(`/p/${SLUG}/brief`);

  await page.getByRole("button", { name: "Clear" }).click();

  await expect(page.getByRole("button", { name: "Build index" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("index-summary")).toHaveCount(0);
});

test("reports a repo that has gone away instead of failing silently", async ({ page }) => {
  const gone = path.join(scratch, "deleted-repo");
  await fsp.mkdir(gone, { recursive: true });
  await fsp.writeFile(FILE, frontmatter(gone.split(path.sep).join("/")), "utf8");
  await fsp.rm(gone, { recursive: true, force: true });

  await page.goto(`/p/${SLUG}/brief`);

  // The repo panel says so, and the index controls are not offered for a repo that is not
  // there — a build could only fail.
  await expect(page.getByText("Not found", { exact: true })).toBeVisible();
  await expect(page.getByTestId("index-panel")).toHaveCount(0);
});

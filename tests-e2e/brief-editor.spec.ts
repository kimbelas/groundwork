import fsp from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The brief editor, its autosave contract, and the lost-update guard.
 *
 * Serial because every test in this file writes the same fixture project; the file is
 * reset before each so a failure cannot cascade into the next test.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "zeta-editable";
const FILE = path.resolve(import.meta.dirname, "fixture-vault", SLUG, "project.md");

const FRONTMATTER = `---
name: Zeta Editable
slug: zeta-editable
stage: shaping
health: green
archetype: internal-tool
columns: [Intake, Build, Done]
created: 2026-08-15
updated: 2026-08-15
---
`;
const ORIGINAL = `${FRONTMATTER}\nORIGINAL BODY MARKER\n`;

async function resetFixture(): Promise<void> {
  await fsp.writeFile(FILE, ORIGINAL, "utf8");
}

async function readFixture(): Promise<string> {
  return fsp.readFile(FILE, "utf8");
}

/** CodeMirror owns its own input handling, so drive it through real keystrokes. */
async function typeBrief(page: import("@playwright/test").Page, text: string): Promise<void> {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
}

test.beforeEach(async () => {
  await resetFixture();
});

test.afterAll(async () => {
  await resetFixture();
});

test("loads the body and not the frontmatter", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  const editor = page.getByTestId("brief-editor");
  await expect(editor).toContainText("ORIGINAL BODY MARKER");

  // The frontmatter must not be reachable from the editor at all.
  await expect(editor).not.toContainText("archetype");
  await expect(editor).not.toContainText("---");
});

test("autosaves, survives a reload, and leaves frontmatter byte-identical", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await typeBrief(page, "Rewritten by the editor.");

  await expect(page.getByTestId("save-state")).toHaveAttribute("data-status", "saved", {
    timeout: 10_000,
  });

  const onDisk = await readFixture();
  expect(onDisk.startsWith(FRONTMATTER)).toBe(true);
  expect(onDisk).toContain("Rewritten by the editor.");
  expect(onDisk).not.toContain("ORIGINAL BODY MARKER");

  await page.reload();
  await expect(page.getByTestId("brief-editor")).toContainText("Rewritten by the editor.");
});

test("Ctrl+S saves without waiting for the debounce", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await typeBrief(page, "Saved by keyboard.");
  await page.keyboard.press("Control+S");

  await expect(page.getByTestId("save-state")).toHaveAttribute("data-status", "saved", {
    timeout: 5_000,
  });
  expect(await readFixture()).toContain("Saved by keyboard.");
});

test("a change on disk blocks the save instead of clobbering it", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await expect(page.getByTestId("brief-editor")).toContainText("ORIGINAL BODY MARKER");

  // Someone else writes the file — Obsidian, another tab, or an AI apply.
  const external = `${FRONTMATTER}\nWRITTEN BY SOMEONE ELSE\n`;
  await fsp.writeFile(FILE, external, "utf8");

  await typeBrief(page, "This must never reach disk.");

  await expect(page.getByTestId("save-notice")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-status", "conflict");

  // The other writer's content survives intact.
  expect(await readFixture()).toBe(external);
});

test("the editor locks after a conflict so retries cannot clobber", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await fsp.writeFile(FILE, `${FRONTMATTER}\nEXTERNAL\n`, "utf8");
  await typeBrief(page, "attempt one");
  await expect(page.getByTestId("save-notice")).toBeVisible({ timeout: 10_000 });

  const after = await readFixture();
  await page.keyboard.type(" attempt two");
  await page.keyboard.press("Control+S");
  await page.waitForTimeout(1500);

  expect(await readFixture()).toBe(after);
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("metadata writes frontmatter and leaves the body untouched", async ({ page }) => {
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByLabel("Stage").selectOption("building");

  await expect(async () => {
    const onDisk = await readFixture();
    expect(onDisk).toContain("stage: building");
  }).toPass({ timeout: 10_000 });

  const onDisk = await readFixture();
  expect(onDisk).toContain("ORIGINAL BODY MARKER");
  expect(onDisk).toContain("name: Zeta Editable");
});

test("a metadata write does not stale the editor's baseline", async ({ page }) => {
  // Both write project.md. Before they shared a baseline, this sequence produced a
  // spurious conflict on the user's very next keystroke.
  await page.goto(`/p/${SLUG}/brief`);
  await page.getByLabel("Health").selectOption("amber");
  await expect(async () => {
    expect(await readFixture()).toContain("health: amber");
  }).toPass({ timeout: 10_000 });

  await typeBrief(page, "Typed after a metadata change.");

  await expect(page.getByTestId("save-state")).toHaveAttribute("data-status", "saved", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("save-notice")).toHaveCount(0);
  expect(await readFixture()).toContain("Typed after a metadata change.");
});

test("the editing surface fills its frame", async ({ page }) => {
  /*
   * The text area you type in is the box you clicked.
   *
   * `.cm-content` carried `max-width: 74ch` — the right measure for reading prose, and on a
   * wide window it left almost 40% of the bordered frame empty to the right of the caret,
   * which reads as a broken text area rather than as typography. Reading surfaces still cap
   * their measure; the editor does not.
   */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${SLUG}/brief`);
  await expect(page.locator(".cm-content")).toBeVisible();

  const box = await page.evaluate(() => {
    const frame = document.querySelector(".editor-frame");
    const content = document.querySelector(".cm-content");
    if (!frame || !content) return null;
    return {
      frame: frame.getBoundingClientRect().width,
      content: content.getBoundingClientRect().width,
    };
  });

  expect(box).not.toBeNull();
  // Within the frame's 1px borders. A measure cap would leave hundreds of pixels.
  expect(box!.frame - box!.content).toBeLessThanOrEqual(4);
});

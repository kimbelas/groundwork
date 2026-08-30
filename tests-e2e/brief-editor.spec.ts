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

const EOL_PAIR = String.fromCharCode(10) + String.fromCharCode(10);

test("scrolls inside its own frame instead of clipping the brief", async ({ page }) => {
  /*
   * The regression this pins.
   *
   * `@uiw/react-codemirror` renders a wrapper div between `.editor-frame` and `.cm-editor`,
   * and nothing sized it. `height: 100%` on `.cm-editor` therefore resolved against an
   * auto-height parent - where it behaves as `auto` - so the editor grew to its content
   * inside a fixed 60vh frame whose `overflow: hidden` clipped it. A long brief lost
   * everything past the fold with no scrollbar anywhere, and the page scrollbar was no help
   * because the frame never grows to reveal what it hides.
   *
   * Asserted on the geometry rather than on a CSS property, because the failure was a
   * cascade resolution and not a missing declaration: every rule involved was present and
   * correct, and the box was still wrong.
   */
  // 120 paragraphs: comfortably taller than the 60vh frame at any viewport.
  const LONG = Array.from({ length: 120 }, () => "A paragraph worth reading.").join(EOL_PAIR);
  await fsp.writeFile(FILE, FRONTMATTER + EOL_PAIR + LONG + EOL_PAIR, "utf8");

  await page.goto(`/p/${SLUG}/brief`);
  await page.waitForSelector(".cm-content");

  const box = await page.evaluate(() => {
    const frame = document.querySelector(".editor-frame");
    const scroller = document.querySelector(".editor-frame .cm-scroller");
    if (!frame || !scroller) return null;
    const before = scroller.scrollTop;
    scroller.scrollTop = 300;
    const after = scroller.scrollTop;
    scroller.scrollTop = before;
    return {
      frameClips: frame.scrollHeight > frame.clientHeight + 1,
      scrollerScrolls: scroller.scrollHeight > scroller.clientHeight + 1,
      moved: after,
    };
  });

  expect(box).not.toBeNull();
  // The frame holds its size and hides nothing of its own...
  expect(box!.frameClips).toBe(false);
  // ...because the scroller inside it is what overflows, and it really moves.
  expect(box!.scrollerScrolls).toBe(true);
  expect(box!.moved).toBeGreaterThan(0);
});

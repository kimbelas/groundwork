import { expect, test } from "@playwright/test";

/**
 * No page may log an error or warning to the console.
 *
 * This exists because a hydration mismatch is invisible in every other test: the markup
 * is right, the assertions pass, and React quietly discards the server HTML and
 * re-renders. It only shows up as a console error and a slower first paint. dnd-kit
 * shipped exactly that on the board, via `aria-describedby` ids counted from a
 * module-level global.
 */
const PAGES = [
  "/",
  "/?archived=1",
  "/p/alpha-portal/brief",
  "/p/eta-board/board",
  "/p/alpha-portal/roadmap",
  "/p/gamma-questions/questions",
];

/** Dev-only noise that says nothing about our markup. */
const IGNORE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /webpack-hmr|turbopack-hmr/i,
];

for (const path of PAGES) {
  test(`no console errors on ${path}`, async ({ page }) => {
    const problems: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() !== "error" && msg.type() !== "warning") return;
      const text = msg.text();
      if (IGNORE.some((re) => re.test(text))) return;
      problems.push(`[${msg.type()}] ${text}`);
    });
    page.on("pageerror", (err) => problems.push(`[pageerror] ${err.message}`));

    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Hydration runs just after first paint, so give React a beat to complain.
    await page.waitForTimeout(1200);

    expect(problems, problems.join("\n---\n")).toEqual([]);
  });
}

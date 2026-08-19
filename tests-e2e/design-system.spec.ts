import { expect, test } from "@playwright/test";

/**
 * The design system, asserted against what the browser actually computed.
 *
 * These checks changed direction when the design did. The old suite enforced austerity
 * — no shadows, 2px radii — which is now the opposite of the goal. What is guarded now
 * is the two things that make or break this design:
 *
 *   1. **Comfort.** Type and hit areas must not shrink back. Small, cramped UI is the
 *      complaint the redesign exists to fix, and it regresses one "just this once" at a
 *      time.
 *   2. **Identity.** No indigo, violet or purple — the generic-AI tell. This check and the
 *      hex list in `scripts/blueprint-lint.js` are both needed: the hue window here misses
 *      Tailwind's `indigo-500`, which sits at hue 239, just outside it.
 *
 * Plus the thing no unit test can cover: that it actually works on a phone.
 */

/** Next's dev overlay is not our markup and must not fail our design rules. */
const SKIP_SELECTOR = "nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay]";

interface Violation {
  selector: string;
  detail: string;
}

async function collectViolations(
  page: import("@playwright/test").Page,
  check: "purple" | "small-text" | "small-tap" | "overflow",
): Promise<Violation[]> {
  return page.evaluate(
    ([checkName, skipSelector]) => {
      const out: { selector: string; detail: string }[] = [];

      const describe = (el: Element): string => {
        const cls =
          typeof el.className === "string" && el.className
            ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
            : "";
        return `${el.tagName.toLowerCase()}${cls}`;
      };

      const toHsl = (rgb: string): { h: number; s: number; l: number } | null => {
        const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb);
        if (!m?.[1] || !m[2] || !m[3]) return null;
        const r = Number(m[1]) / 255;
        const g = Number(m[2]) / 255;
        const b = Number(m[3]) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        const d = max - min;
        if (d === 0) return { h: 0, s: 0, l };
        const s = d / (1 - Math.abs(2 * l - 1));
        let h: number;
        if (max === r) h = 60 * (((g - b) / d) % 6);
        else if (max === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
        if (h < 0) h += 360;
        return { h, s, l };
      };

      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      };

      const elements = Array.from(document.querySelectorAll("body *")).filter(
        (el) => !el.closest(skipSelector),
      );

      for (const el of elements) {
        const cs = getComputedStyle(el);

        if (checkName === "purple") {
          for (const prop of ["color", "backgroundColor", "borderTopColor"] as const) {
            const hsl = toHsl(cs[prop]);
            // Indigo/violet is hue 240-300. Allowed only if effectively greyscale.
            if (hsl && hsl.s > 0.15 && hsl.h >= 240 && hsl.h <= 300) {
              out.push({ selector: describe(el), detail: `${prop}: ${cs[prop]}` });
              break;
            }
          }
        }

        if (checkName === "small-text") {
          // Only elements holding their own text; a wrapper's inherited size is not a
          // separate violation.
          const ownText = Array.from(el.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0,
          );
          if (!ownText || !visible(el)) continue;
          const px = Number.parseFloat(cs.fontSize);
          if (Number.isFinite(px) && px < 12) {
            out.push({ selector: describe(el), detail: `${cs.fontSize} text` });
          }
        }

        if (checkName === "small-tap") {
          const interactive =
            el.matches("button, a, select, input, textarea, [role='button']") && visible(el);
          if (!interactive) continue;
          // Checkboxes are sized by their padded label, which is what gets tapped.
          if (el.matches("input[type='checkbox']")) continue;
          /*
           * Inline links are exempt. A link inside a sentence is sized by its text and
           * cannot be 32px tall without breaking the line box; its tap area comes from
           * the padding of the row or cell around it. The rule is about controls —
           * buttons, selects, and links laid out as blocks such as tabs and rail items.
           */
          if (el.tagName === "A" && cs.display.startsWith("inline")) continue;
          const r = el.getBoundingClientRect();
          if (r.height < 32) {
            out.push({ selector: describe(el), detail: `${Math.round(r.height)}px tall` });
          }
        }

        if (checkName === "overflow") {
          if (!visible(el)) continue;
          /*
           * Content inside a deliberately scrollable region is allowed to extend past
           * the viewport — that is what the region is for. The mobile tab strip scrolls
           * horizontally by design. What must never overflow is the page itself, which
           * the "never scrolls sideways" test covers.
           */
          let scrollable = false;
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const overflowX = getComputedStyle(p).overflowX;
            if (overflowX === "auto" || overflowX === "scroll") {
              scrollable = true;
              break;
            }
          }
          if (scrollable) continue;

          const r = el.getBoundingClientRect();
          // 2px of tolerance for sub-pixel layout rounding.
          if (r.right > document.documentElement.clientWidth + 2) {
            out.push({
              selector: describe(el),
              detail: `extends ${Math.round(r.right - document.documentElement.clientWidth)}px past the viewport`,
            });
          }
        }
      }

      return out;
    },
    [check, SKIP_SELECTOR] as const,
  );
}

const PAGES = [
  { path: "/", ready: "table" as const },
  { path: "/p/alpha-portal/brief", ready: "editor" as const },
  { path: "/p/eta-board/board", ready: "board" as const },
  { path: "/p/kappa-roadmap/roadmap", ready: "track" as const },
  { path: "/p/kappa-roadmap/log", ready: "log" as const },
  { path: "/p/gamma-questions/questions", ready: "questions" as const },
];

async function waitReady(
  page: import("@playwright/test").Page,
  ready: (typeof PAGES)[number]["ready"],
): Promise<void> {
  if (ready === "table") await expect(page.getByRole("table")).toBeVisible();
  else if (ready === "editor") await expect(page.locator(".cm-content")).toBeVisible();
  else if (ready === "board") await expect(page.getByTestId("board")).toBeVisible();
  else if (ready === "track") await expect(page.getByTestId("phase-track")).toBeVisible();
  else if (ready === "log") await expect(page.getByTestId("decision-log")).toBeVisible();
  else await expect(page.getByTestId("questions-list")).toBeVisible();
}

for (const { path, ready } of PAGES) {
  test.describe(`design rules on ${path}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(path);
      await waitReady(page, ready);
    });

    test("no indigo, violet or purple", async ({ page }) => {
      expect(await collectViolations(page, "purple")).toEqual([]);
    });

    test("no text below 12px", async ({ page }) => {
      expect(await collectViolations(page, "small-text")).toEqual([]);
    });

    test("no interactive element under 32px tall", async ({ page }) => {
      expect(await collectViolations(page, "small-tap")).toEqual([]);
    });
  });
}

test.describe("typography", () => {
  test("body text is comfortable, not compact", async ({ page }) => {
    await page.goto("/p/gamma-questions/questions");
    const size = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.body).fontSize),
    );
    expect(size).toBeGreaterThanOrEqual(16);
  });

  test("project titles out-rank body copy without a second face", async ({ page }) => {
    // The serif display face was dropped deliberately: one sans, one mono. A title still
    // has to read as a title, so what used to be carried by the face is now carried by
    // size and weight — and this asserts that, rather than merely asserting the serif left.
    await page.goto("/");
    const seen = await page
      .getByRole("table")
      .getByRole("link", { name: "Alpha Portal" })
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          family: cs.fontFamily.toLowerCase(),
          size: Number.parseFloat(cs.fontSize),
          weight: Number(cs.fontWeight),
        };
      });

    expect(seen.family).not.toContain("newsreader");
    expect(seen.family).not.toContain("georgia");
    expect(seen.size).toBeGreaterThanOrEqual(18);
    expect(seen.weight).toBeGreaterThanOrEqual(500);
  });

  test("the chosen sans is actually the one rendering", async ({ page }) => {
    // Everything else here asserts an *absence* — no newsreader, no georgia. If the face
    // failed to load, or the CSS variable got shadowed, the whole app would fall back to
    // system-ui and every one of those checks would still pass. This is the only case that
    // notices, and it is the reason it exists.
    await page.goto("/");
    const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(body.toLowerCase()).toContain("instrument");
  });

  test("no second display face anywhere on the page", async ({ page }) => {
    // The check above looks at one link on one page, which is not what stops a serif
    // reappearing at a selector nobody thought to assert on. This walks everything.
    await page.goto("/");
    await expect(page.getByRole("table")).toBeVisible();

    const families = await page.evaluate((skip) => {
      const seen = new Set<string>();
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        if (el.closest(skip)) continue;
        seen.add(getComputedStyle(el).fontFamily.toLowerCase());
      }
      return [...seen];
    }, SKIP_SELECTOR);

    expect(families.filter((f) => f.includes("newsreader") || f.includes("georgia"))).toEqual([]);
  });

  test("cards are tall enough to read at a glance", async ({ page }) => {
    await page.goto("/p/eta-board/board");
    const box = await page.getByTestId("card-1").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(80);
  });

  test("exactly one h1, and the vault nav is labelled", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Vault" })).toBeVisible();
  });
});

/**
 * Theme.
 *
 * These used to be one test that opened a `colorScheme: "dark"` context and checked the
 * background was painted. That test would now **pass while measuring the light palette** —
 * light is the default and following the OS is opt-in, so a dark browser preference alone
 * no longer produces a dark app. An assertion that cannot fail is worse than no assertion,
 * because it reads as coverage.
 *
 * So each case states which of the three states it is in, and one of them exists purely to
 * prove the default ignores the OS.
 */
const THEME_COOKIE = "gw.theme";

async function pageWithTheme(
  browser: import("@playwright/test").Browser,
  opts: { theme?: string; prefers?: "dark" | "light" } = {},
) {
  const context = await browser.newContext({ colorScheme: opts.prefers ?? "light" });
  if (opts.theme) {
    await context.addCookies([
      { name: THEME_COOKIE, value: opts.theme, url: "http://127.0.0.1:4849" },
    ]);
  }
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("table")).toBeVisible();
  return { context, page };
}

const bodyBackground = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe("theme", () => {
  test("a dark OS alone does not darken the app", async ({ browser }) => {
    // The reason the default exists. Anyone with a dark desktop used to get a dark planning
    // tool they never asked for, with no way to say otherwise.
    const { context, page } = await pageWithTheme(browser, { prefers: "dark" });
    const light = await pageWithTheme(browser, { theme: "light", prefers: "light" });

    expect(await bodyBackground(page)).toBe(await bodyBackground(light.page));
    await context.close();
    await light.context.close();
  });

  test("an explicit dark choice paints dark and stays clear of purple", async ({ browser }) => {
    const { context, page } = await pageWithTheme(browser, { theme: "dark", prefers: "light" });

    const bg = await bodyBackground(page);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("rgb(0, 0, 0)");

    const light = await pageWithTheme(browser, { theme: "light" });
    expect(bg).not.toBe(await bodyBackground(light.page));

    expect(await collectViolations(page, "purple")).toEqual([]);
    await context.close();
    await light.context.close();
  });

  test("choosing system follows the OS in both directions", async ({ browser }) => {
    const dark = await pageWithTheme(browser, { theme: "system", prefers: "dark" });
    const light = await pageWithTheme(browser, { theme: "system", prefers: "light" });

    expect(await bodyBackground(dark.page)).not.toBe(await bodyBackground(light.page));
    await dark.context.close();
    await light.context.close();
  });

  test("the two dark blocks have not drifted apart", async ({ browser }) => {
    // CSS cannot put a media condition inside a selector list, so the dark palette is
    // written twice — once for the explicit choice, once inside the media query for
    // "system". Nothing but this stops the two copies diverging.
    //
    // It reads EVERY custom property off the root, not just the background. An earlier
    // version compared `body`'s background alone, which is one of twenty tokens: --accent,
    // --ink, --line, the five status hues and the three shadows could all have diverged
    // while it passed. A guard that covers 5% of what it claims to guard is worse than
    // none, because the comment above says it is covered.
    const readTokens = (page: import("@playwright/test").Page) =>
      page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const names = Array.from(document.styleSheets)
          .flatMap((sheet) => {
            try {
              return Array.from(sheet.cssRules);
            } catch {
              return []; // a cross-origin sheet, which cannot hold our tokens anyway
            }
          })
          .flatMap((rule) =>
            rule instanceof CSSStyleRule ? Array.from(rule.style) : [],
          )
          .filter((prop) => prop.startsWith("--"));

        const seen: Record<string, string> = {};
        for (const name of new Set(names)) seen[name] = style.getPropertyValue(name).trim();
        return seen;
      });

    const explicit = await pageWithTheme(browser, { theme: "dark", prefers: "light" });
    const viaSystem = await pageWithTheme(browser, { theme: "system", prefers: "dark" });

    const a = await readTokens(explicit.page);
    const b = await readTokens(viaSystem.page);

    // If this ever finds nothing, the reader has stopped working and the test is vacuous.
    expect(Object.keys(a).length).toBeGreaterThan(15);
    expect(b).toEqual(a);

    await explicit.context.close();
    await viaSystem.context.close();
  });

  test("the purple ban holds in dark, both ways of reaching it", async ({ browser }) => {
    // The sweep used to run against explicit dark only, so a violation reachable solely
    // through the "system" copy of the palette was never looked at.
    for (const opts of [
      { theme: "dark", prefers: "light" as const },
      { theme: "system", prefers: "dark" as const },
    ]) {
      const { context, page } = await pageWithTheme(browser, opts);
      expect(await collectViolations(page, "purple")).toEqual([]);
      await context.close();
    }
  });

  test("the toggle changes the palette and survives a reload", async ({ browser }) => {
    const { context, page } = await pageWithTheme(browser);
    const before = await bodyBackground(page);

    await page.getByTestId("theme-toggle").click();
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-theme-value", "dark");
    expect(await bodyBackground(page)).not.toBe(before);

    // The cookie is what makes the *first paint* after a reload correct, which is the whole
    // reason this is not localStorage.
    await page.reload();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-theme-value", "dark");
    expect(await bodyBackground(page)).not.toBe(before);

    await context.close();
  });
});

/**
 * Mobile is a first-class target, not a nice-to-have. These run at a real phone
 * viewport, because a layout can pass every desktop check and still be unusable at
 * 390px.
 */
test.describe("mobile at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const { path, ready } of PAGES) {
    test(`nothing overflows the viewport on ${path}`, async ({ page }) => {
      await page.goto(path);
      await waitReady(page, ready);
      expect(await collectViolations(page, "overflow")).toEqual([]);
    });
  }

  test("the page never scrolls sideways", async ({ page }) => {
    await page.goto("/p/eta-board/board");
    await expect(page.getByTestId("board")).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    );
    expect(overflows).toBe(false);
  });

  test("the rail is a drawer that opens, navigates and closes", async ({ page }) => {
    await page.goto("/");

    const rail = page.getByRole("navigation", { name: "Vault" });
    // Off-canvas to start: present in the DOM, translated out of view.
    const offscreenLeft = await rail.evaluate((el) => el.getBoundingClientRect().right);
    expect(offscreenLeft).toBeLessThanOrEqual(0);

    await page.getByTestId("menu-toggle").click();
    await expect(page.getByTestId("menu-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(async () => {
      const right = await rail.evaluate((el) => el.getBoundingClientRect().right);
      expect(right).toBeGreaterThan(100);
    }).toPass({ timeout: 5_000 });

    await rail.getByRole("link", { name: /Alpha Portal/ }).click();
    await expect(page).toHaveURL(/\/p\/alpha-portal\/brief$/);
    // Navigating closes the drawer rather than leaving it covering the page.
    await expect(page.getByTestId("menu-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  test("the overlay closes the drawer", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("menu-toggle").click();
    await expect(page.getByTestId("rail-overlay")).toBeVisible();

    // Click to the right of the open drawer. The overlay spans the whole viewport, so
    // its centre sits underneath the drawer and a default click would hit that instead.
    await page.getByTestId("rail-overlay").click({ position: { x: 360, y: 500 } });
    await expect(page.getByTestId("rail-overlay")).toHaveCount(0);
    await expect(page.getByTestId("menu-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  test("board columns stack instead of scrolling sideways", async ({ page }) => {
    await page.goto("/p/eta-board/board");
    await expect(page.getByTestId("board")).toBeVisible();

    const boxes = await page
      .locator(".column")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    expect(boxes.length).toBeGreaterThan(1);
    // Stacked, so each column starts below the previous one.
    expect(boxes[1] ?? 0).toBeGreaterThan(boxes[0] ?? 0);
  });

  test("the dashboard reads as cards, not a cramped table", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("table")).toBeVisible();

    // The header row is hidden and each cell carries its own label instead.
    const headVisible = await page
      .locator("thead")
      .evaluate((el) => getComputedStyle(el).display !== "none");
    expect(headVisible).toBe(false);

    const label = await page
      .getByRole("row", { name: /Alpha Portal/ })
      .locator("td[data-label='Stage']")
      .evaluate((el) => getComputedStyle(el, "::before").content);
    expect(label.toLowerCase()).toContain("stage");
  });

  test("tap targets stay reachable at phone width", async ({ page }) => {
    await page.goto("/p/gamma-questions/questions");
    await expect(page.getByTestId("questions-list")).toBeVisible();
    expect(await collectViolations(page, "small-tap")).toEqual([]);
  });
});

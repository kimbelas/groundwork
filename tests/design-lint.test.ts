import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The guardrail's guardrail.
 *
 * `scripts/blueprint-lint.js` runs on every `.tsx`/`.jsx`/`.css` edit and is the only thing
 * standing between the design and a slow slide back to what was rejected. Nothing tested it,
 * and it accumulated three separate fail-open holes before anyone noticed:
 *
 *   1. Both floors matched `px` only, so a `rem` scale switched them off.
 *   2. The tap vocabulary was wrapped in word boundaries, which made every dotted entry
 *      dead — a leading boundary before a literal "." only matches when a word character
 *      precedes it, which never happens for a bare class selector. Only `button` ever fired.
 *   3. Neither floor followed `var(--token)`, so a token scale — the entire point of the
 *      redesign — was invisible to both.
 *
 * All three shared a shape: the rule did not *match*, so it reported nothing, and silence
 * reads exactly like success. These are execution tests rather than source assertions for
 * that reason. The vocabulary case below is generated from the file itself, so a name added
 * to the list without actually firing fails here rather than years later.
 */

const run = promisify(execFile);
const LINTER = path.resolve(process.cwd(), "scripts/blueprint-lint.js");

let dir: string;

async function lint(css: string, ext = ".css"): Promise<{ code: number; out: string }> {
  const file = path.join(dir, `case-${Math.random().toString(36).slice(2)}${ext}`);
  await fsp.writeFile(file, css, "utf8");
  try {
    await run("node", [LINTER, file], { windowsHide: true });
    return { code: 0, out: "" };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: e.code ?? 1, out: e.stderr ?? "" };
  }
}

/** The vocabulary as the shipped file actually declares it, not a copy that can drift. */
function tapNames(): string[] {
  const src = fs.readFileSync(LINTER, "utf8");
  const block = /const TAP_NAMES = \[([\s\S]*?)\];/.exec(src);
  if (!block?.[1]) throw new Error("TAP_NAMES not found in the linter");
  // The entries are regex source in a JS string, so a dotted name reaches us as two literal
  // backslashes plus the dot. Strip every backslash to get the selector a stylesheet writes.
  // Leaving one behind makes the case below pass on a substring match rather than a real
  // selector, which is the same kind of quiet pass this file exists to prevent.
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => (m[1] ?? "").replace(/\\/g, ""));
}

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-lint-"));
});

afterAll(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("the linter runs at all", () => {
  it("passes the real stylesheet", async () => {
    const { stdout } = await run("node", [LINTER, "app/globals.css"], { windowsHide: true });
    expect(stdout).toBe("");
  });

  it("ignores files it does not govern", async () => {
    const { code } = await lint("font-size: 4px;", ".md");
    expect(code).toBe(0);
  });

  it("governs .ts, because CSS-in-TS is still CSS", async () => {
    // `components/editor/blueprintHighlight.ts` styles the editor from a plain object, and
    // it held one of the eight references to the display face. Under the original
    // `.(tsx|jsx|css)` filter no automation could ever have reminded anyone it existed.
    const { code } = await lint('const theme = { color: "#6366f1" };', ".ts");
    expect(code).toBe(1);
  });

  it("reads camelCase properties, not only kebab-case", async () => {
    // Widening the filter to .ts buys nothing on its own: an object literal writes
    // `fontSize`, and a kebab-only pattern walks straight past it.
    const { code, out } = await lint('const s = { fontSize: "10px" };', ".ts");
    expect(code).toBe(1);
    expect(out).toContain("type too small");
  });
});

describe("type floor", () => {
  it("catches px below the floor", async () => {
    const { code, out } = await lint(".x { font-size: 10px; }");
    expect(code).toBe(1);
    expect(out).toContain("type too small");
  });

  it("catches rem below the floor", async () => {
    // 0.625rem is 10px. Before this was handled, a rem scale disabled the rule entirely.
    const { code } = await lint(".x { font-size: 0.625rem; }");
    expect(code).toBe(1);
  });

  it("catches a token that resolves below the floor", async () => {
    const { code, out } = await lint(":root { --text-xs: 9px; }\n.x { font-size: var(--text-xs); }");
    expect(code).toBe(1);
    expect(out).toContain("resolves to 9px");
  });

  it("follows a token through another token", async () => {
    const { code } = await lint(
      ":root { --base: 8px; --small: var(--base); }\n.x { font-size: var(--small); }",
    );
    expect(code).toBe(1);
  });

  it("uses a var fallback when the token is undeclared", async () => {
    const { code } = await lint(".x { font-size: var(--missing, 9px); }");
    expect(code).toBe(1);
  });

  it("judges a function by its smallest length", async () => {
    // The floor exists to catch the worst case, and clamp's floor is its first argument.
    const { code } = await lint(".x { font-size: clamp(9px, 2vw, 24px); }");
    expect(code).toBe(1);
  });

  it("allows legal sizes in either unit", async () => {
    const { code } = await lint(".a { font-size: 16px; }\n.b { font-size: 1rem; }");
    expect(code).toBe(0);
  });

  it("does not fire on a self-referential token", async () => {
    // Nonsense CSS, but it must terminate rather than recurse forever.
    const { code } = await lint(":root { --a: var(--a); }\n.x { font-size: var(--a); }");
    expect(code).toBe(0);
  });
});

describe("tap floor", () => {
  it("catches a token that resolves below the floor", async () => {
    const { code, out } = await lint(":root { --tap: 20px; }\n.nav-item { min-height: var(--tap); }");
    expect(code).toBe(1);
    expect(out).toContain("tap target too small");
  });

  it("allows a token that resolves above it", async () => {
    const { code } = await lint(":root { --tap: 44px; }\n.nav-item { min-height: var(--tap); }");
    expect(code).toBe(0);
  });

  it("stays silent on something that is not a control", async () => {
    const { code } = await lint(".card-meta { min-height: 20px; }");
    expect(code).toBe(0);
  });

  it("does not mistake a container for its control", async () => {
    // `.tabs` is the strip, `.tab` is the control. The trailing lookahead is what separates
    // them; a plain substring match would flag every tab strip in the app.
    const { code } = await lint(".tabs { min-height: 20px; }");
    expect(code).toBe(0);
  });
});

describe("the tap vocabulary is live, not decorative", () => {
  const names = tapNames();

  it("is not empty", () => {
    expect(names.length).toBeGreaterThan(10);
  });

  // Generated from the shipped list. Adding a name that does not actually fire fails here.
  it.each(names)("%s fires on a bare selector", async (name) => {
    const selector = name === "button" ? "button" : name;
    const { code } = await lint(`${selector} { min-height: 20px; }`);
    expect(code).toBe(1);
  });
});

describe("colour and chrome", () => {
  it("rejects a banned hex", async () => {
    const { code, out } = await lint(".x { color: #6366f1; }");
    expect(code).toBe(1);
    expect(out).toContain("indigo/violet");
  });

  it("rejects a one-off hex outside the token block", async () => {
    const { code } = await lint(".x { color: #123456; }");
    expect(code).toBe(1);
  });

  it("allows hex inside a custom property, because that is the palette", async () => {
    const { code } = await lint(":root { --accent: #2563eb; }");
    expect(code).toBe(0);
  });

  it("refuses a second display face in CSS", async () => {
    const { code, out } = await lint(".x { font-family: var(--font-newsreader), Georgia, serif; }");
    expect(code).toBe(1);
    expect(out).toContain("second display face");
  });

  it("refuses a second display face in CSS-in-TS", async () => {
    // The editor theme sets its own font from an object literal. This is the case the
    // original `.(tsx|jsx|css)` filter could not see at all.
    const { code } = await lint('const t = { fontFamily: "Newsreader, Georgia, serif" };', ".ts");
    expect(code).toBe(1);
  });

  it("does not mistake the sans-serif keyword for a serif", async () => {
    const { code } = await lint(".y { font-family: var(--font-sans), system-ui, sans-serif; }");
    expect(code).toBe(0);
  });

  it("rejects emoji in chrome", async () => {
    const { code, out } = await lint('.x::before { content: "✅"; }');
    expect(code).toBe(1);
    expect(out).toContain("emoji");
  });
});

import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  THEME_COOKIE,
  THEMES,
  nextTheme,
  parseTheme,
  themeCookie,
  themeLabel,
  type Theme,
} from "@/lib/theme";

describe("parseTheme", () => {
  it("accepts every theme it declares", () => {
    for (const theme of THEMES) expect(parseTheme(theme)).toBe(theme);
  });

  it("defaults to light when there is no cookie", () => {
    expect(parseTheme(undefined)).toBe("light");
    expect(parseTheme(null)).toBe("light");
    expect(parseTheme("")).toBe("light");
  });

  /**
   * The case that keeps the app up.
   *
   * A cookie is user-editable and outlives deploys, so it will eventually hold a value this
   * build has never heard of. This is read in the root layout, and a layout that throws
   * takes down every page — so an unknown value has to render something rather than fail.
   */
  it("falls back rather than throwing on a value it does not know", () => {
    for (const junk of ["sepia", "DARK", "{}", "../../etc", "light dark", "  "]) {
      expect(parseTheme(junk)).toBe(DEFAULT_THEME);
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseTheme(" dark ")).toBe("dark");
  });

  it("does not follow the OS by default", () => {
    // The whole point of the default: a dark desktop must not silently produce a dark app.
    expect(DEFAULT_THEME).toBe("light");
    expect(parseTheme(undefined)).not.toBe("system");
  });
});

describe("themeCookie", () => {
  it("writes a value the parser reads back", () => {
    for (const theme of THEMES) {
      const value = themeCookie(theme).split(";")[0]?.split("=")[1];
      expect(parseTheme(value)).toBe(theme);
    }
  });

  it("is scoped to the whole app and persists", () => {
    const cookie = themeCookie("dark");
    expect(cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  it("omits Secure, which would drop the cookie over plain HTTP on localhost", () => {
    expect(themeCookie("dark")).not.toContain("Secure");
  });
});

describe("nextTheme", () => {
  it("cycles through every theme and returns to the start", () => {
    const seen: Theme[] = [];
    let current: Theme = DEFAULT_THEME;
    for (let i = 0; i < THEMES.length; i += 1) {
      seen.push(current);
      current = nextTheme(current);
    }
    expect(new Set(seen).size).toBe(THEMES.length);
    expect(current).toBe(DEFAULT_THEME);
  });
});

describe("themeLabel", () => {
  it("gives every theme a word", () => {
    for (const theme of THEMES) {
      const label = themeLabel(theme);
      expect(label).not.toBe("");
      expect(label).toBe(label[0]?.toUpperCase() + label.slice(1));
    }
  });
});

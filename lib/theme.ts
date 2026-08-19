/**
 * Which palette the interface paints in, and how that survives a reload.
 *
 * Three states, not two. "system" follows `prefers-color-scheme`; the other two override it.
 * **Light is the default, deliberately** — the app used to follow the OS with no way to say
 * otherwise, so anyone with a dark desktop got a dark planning tool they never chose. An
 * explicit default plus an explicit opt-in is the honest version of that.
 *
 * A cookie rather than localStorage, for one reason that matters: this value decides which
 * palette the *first paint* uses. localStorage is only readable after hydration, so every
 * navigation would paint light and then flip — a visible flash on every page. A cookie is
 * read in the root layout, so the correct attribute is in the first byte of HTML.
 *
 * Plain TypeScript with no React import, so both the server layout and the client control
 * can share it.
 */

export const THEME_COOKIE = "gw.theme";

export const THEMES = ["light", "dark", "system"] as const;

export type Theme = (typeof THEMES)[number];

/** Light unless the reader has said otherwise. */
export const DEFAULT_THEME: Theme = "light";

/** A year. The preference is not something anyone wants to re-state. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

/**
 * Read a cookie value into a theme, falling back rather than throwing.
 *
 * A cookie is user-editable and survives deploys, so it will eventually hold something this
 * code has never heard of — a stale value from an older build, or a hand-edited one. That
 * has to render *something*, and the default is the only safe answer. A layout that throws
 * takes down every page in the app.
 */
export function parseTheme(raw: string | undefined | null): Theme {
  if (!raw) return DEFAULT_THEME;
  const trimmed = raw.trim();
  return isTheme(trimmed) ? trimmed : DEFAULT_THEME;
}

/**
 * The `document.cookie` string that stores a preference.
 *
 * `SameSite=Lax` because nothing cross-site should be able to set it, and no `Secure` flag
 * because the app is served over plain HTTP on 127.0.0.1 — `Secure` would silently drop it.
 */
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** What the toggle moves to next, cycling light → dark → system → light. */
export function nextTheme(current: Theme): Theme {
  const i = THEMES.indexOf(current);
  return THEMES[(i + 1) % THEMES.length] ?? DEFAULT_THEME;
}

/** The words the control shows. Codes in files, words on screen. */
export function themeLabel(theme: Theme): string {
  switch (theme) {
    case "light":
      return "Light";
    case "dark":
      return "Dark";
    case "system":
      return "System";
  }
}

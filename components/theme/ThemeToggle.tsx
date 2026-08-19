"use client";

import { useState } from "react";

import { type Theme, nextTheme, themeCookie, themeLabel } from "@/lib/theme";

/**
 * Cycles light → dark → system.
 *
 * Three things change, in this order, and the order matters:
 *
 *   1. `documentElement.dataset.theme` — the CSS reads this, so the palette repaints
 *      immediately and does not wait on React.
 *   2. `document.cookie` — so the *next* first paint is already correct, server-side.
 *   3. React state — so this control's own label and pressed state follow.
 *
 * Writing the DOM first means the theme still switches if hydration is mid-flight, and it
 * avoids the round trip a server action would cost for something this small. There is no
 * route handler for the same reason: nothing on the server needs to know, it only needs to
 * be able to read the cookie next time.
 *
 * `initial` seeds state from the server-rendered value. That is not the forbidden
 * copy-server-data-into-useState pattern: after mount the client is the only writer, so
 * there is no later server value for `useState` to ignore. The component is never given a
 * `key` that would remount it and re-seed from a stale prop.
 */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  function cycle() {
    const next = nextTheme(theme);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next === "system" ? "light dark" : next;
    document.cookie = themeCookie(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      data-testid="theme-toggle"
      data-theme-value={theme}
      // The control is a cycle, not a switch, so `aria-pressed` would misdescribe it. The
      // label carries both the current state and what pressing it does.
      aria-label={`Theme: ${themeLabel(theme)}. Change to ${themeLabel(nextTheme(theme))}.`}
    >
      <ThemeIcon theme={theme} />
      <span>{themeLabel(theme)}</span>
    </button>
  );
}

/** Sun, moon, or a half-filled circle for "whatever the machine says". */
function ThemeIcon({ theme }: { theme: Theme }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "theme-icon",
  };

  if (theme === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }

  if (theme === "dark") {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

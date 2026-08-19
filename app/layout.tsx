import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";

import { Rail } from "@/components/rail/Rail";
import { RailShell } from "@/components/rail/RailShell";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

import "./globals.css";

/**
 * One sans, one mono. There is no display face.
 *
 * A serif ran on titles for two revisions, on the argument that it stopped the app reading
 * as a generic dashboard. It was doing that job, but the app being rebuilt is a tool rather
 * than a document, and the tools it is modelled on all use a single family — hierarchy comes
 * from size, weight and space instead. `scripts/blueprint-lint.js` and
 * `tests-e2e/design-system.spec.ts` both refuse a second display face now, so this is a
 * decision the codebase enforces rather than remembers.
 *
 * Instrument Sans rather than Inter: Inter is the face every generated interface reaches
 * for, and looking generic is the specific complaint this rebuild exists to answer.
 */
const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Groundwork",
  description: "A local-first planning workspace for projects you're starting up.",
};

/** `maximum-scale` is deliberately left alone — pinch-zoom must never be disabled. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * The theme attribute is written here, on the server, and that placement is the whole
 * design.
 *
 * It decides which palette the *first paint* uses. Read it on the client instead and every
 * navigation paints light and then flips, which is a visible flash on every page. Reading
 * the cookie in the root layout puts the right value in the first byte of HTML, so there is
 * never an unstamped state for the CSS to guess at.
 *
 * `colorScheme` tells the browser which way the page leans, so form controls, scrollbars and
 * the canvas behind the body match instead of staying stubbornly light.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme}
      style={{ colorScheme: theme === "system" ? "light dark" : theme }}
      className={`${sans.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <RailShell rail={<Rail />}>{children}</RailShell>
      </body>
    </html>
  );
}

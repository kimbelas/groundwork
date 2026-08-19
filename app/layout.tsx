import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";

import { Rail } from "@/components/rail/Rail";
import { RailShell } from "@/components/rail/RailShell";

import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-newsreader",
  display: "swap",
});

/**
 * Inter rather than Inter Tight: at 17px in long paragraphs the tighter face reads as
 * cramped, which is the complaint this revamp exists to fix.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <RailShell rail={<Rail />}>{children}</RailShell>
      </body>
    </html>
  );
}

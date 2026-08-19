import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Next 16 allows only one `next dev` per build directory and refuses a second one
   * whatever port it is given. Without an override, having the app open on 4848 would
   * block the entire e2e suite — so Playwright points its server at its own dist dir.
   */
  distDir: process.env.GROUNDWORK_DIST_DIR ?? ".next",

  /** Silences the multi-lockfile root inference warning; this repo is the root. */
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;

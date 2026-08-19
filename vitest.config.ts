import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    /**
     * Above the 5s default because several suites do real work rather than mocking it:
     * they spawn `git`, create throwaway repos, and write vault fixtures. On Windows
     * those subprocesses and the file locks around them routinely exceed 5s under load,
     * which shows up as a flake that says nothing about the code.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Playwright specs live in tests-e2e/ and are driven by its own runner.
    exclude: ["node_modules/**", "tests-e2e/**", ".next/**"],
  },
});

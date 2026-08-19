import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    // The e2e server's own build dir (see next.config.ts distDir override).
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "vault/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  {
    rules: {
      // The vault layer intentionally swallows errors it has decided are non-fatal
      // (a missing optional file, an unwatchable directory). Empty catch blocks there
      // are load-bearing and always commented.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;

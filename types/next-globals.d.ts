/// <reference types="next" />
/// <reference types="next/image-types/global" />

/**
 * Stands in for the generated `next-env.d.ts`, which is deliberately excluded from the
 * TypeScript program.
 *
 * Next rewrites `next-env.d.ts` on every server boot and appends an import of the
 * generated route types for whichever `distDir` booted last. Because the e2e server
 * uses its own `distDir` (see next.config.ts), that made `pnpm typecheck` pass or fail
 * depending on whether you had most recently run `pnpm dev` or `pnpm test:e2e` — and an
 * imported file bypasses tsconfig `exclude`, so it could not be filtered out.
 *
 * Keeping only these two reference directives makes typechecking deterministic. The
 * cost is Next's route-literal typing (`PageProps<"/p/[slug]">` and friends), so route
 * params are typed by hand instead. Navigation correctness is covered by the e2e suite.
 */

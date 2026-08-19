## Project: Groundwork

A local-first planning workspace. Obsidian-style markdown vault plus an AI planning
stage. Next.js 16 App Router, React 19, TypeScript, Tailwind 4, pnpm. Runs only on
`127.0.0.1:4848`.

Read `docs/` before making architectural changes. `docs/02-architecture.md` and
`docs/03-data-model.md` are the load-bearing ones.

### Hard rules

- **All disk access goes through `lib/vault.ts`.** No `fs` calls in components, route
  handlers, or anywhere else. Slug validation and path-traversal rejection live there
  and must not be bypassed. The single exception is `lib/runs.ts`, which owns
  `.groundwork/runs/` and never resolves a path inside `vault/` — that separation is
  what lets the spawned CLI hold write access to one directory only. Do not add a
  third exception without the same argument.
- **The AI never writes into `vault/`.** It writes a proposal JSON to
  `.groundwork/runs/<runId>/proposal.json`. The app validates it with zod, shows a
  diff, and applies it only on user accept — after snapshotting. Enforced by
  `.claude/settings.json`: the spawned CLI's Write permission covers only
  `.groundwork/runs/**`.
- **Snapshot before every apply.** Copy each target file into
  `vault/<slug>/.snapshots/<ISO>/` first. Revert restores the newest snapshot.
- **One AI run at a time**, enforced by a lock file.
- **Auto-commit is bookkeeping, never a precondition.** `lib/git.ts` failing must not
  fail an apply — log it, surface a notice, move on. Stage explicit paths only; never
  `git commit -a`.

### Design rules — do not regress these

The visual language is **Clean & Bright** (see `docs/05-design-system.md`). It replaced an
earlier dense design that was rejected for being too small and too cramped, so the rules
guard comfort rather than austerity.

That document described a *different* palette for a full revision after the CSS had moved
on, and nothing caught it. **A change to the design changes its guardrail — the lint rule,
the e2e assertion and the doc — in the same commit.** Anything less is how the last drift
happened.

- **Comfortable sizing is not up for negotiation.** No type below 12px, body copy 15px or
  larger, controls at the floor below. A redesign may change the shape; it does not get to
  buy space back by shrinking the scale. Small type is the specific complaint that got the
  previous design thrown out.
- **Controls target 44px** of hit area (`var(--tap)`); **the enforced floor is 32px
  measured**, which is what both `scripts/blueprint-lint.js` and `design-system.spec.ts`
  check. The gap between the two numbers is headroom on purpose. Inline text links are
  exempt: they are sized by their text and take their hit area from the row around them.
- **Token sizes stay in `px`.** The linter resolves a `rem` against a 16px root so a stray
  one cannot slip under a floor, but it cannot resolve a root size declared in another
  file. Do not author the scale in `rem` and rely on the check.
- **No hard-coded colours outside the token block** in `globals.css`. Use `--ink`,
  `--surface`, `--line`, `--accent`, or a `--s-*` status hue.
- **No indigo, violet or purple** — the generic-AI tell, and the one hue family both
  enforcement layers hunt for. **No Tailwind cool-grey utility classes** (`slate`, `zinc`,
  `gray`); that rule bans the class names, and the token block being slate-derived by hex
  is legitimate, since the tokens *are* the palette.
- **No emoji in UI chrome.** Use a status chip or an inline SVG.
- **Words on screen, codes in files.** Display "High" and "80% sure" via `lib/labels.ts`;
  the vault keeps `P1` and `0.8` because a person hand-edits those files.
- **Serif display face stays.** Newsreader on titles is what stops this reading as a
  generic dashboard.
- **Every screen works at 390px.** Columns stack, the rail is a drawer, the dashboard
  table becomes cards. Never disable pinch-zoom.

### Conventions

- Sizes are S/M/L and confidence is 0–1. **Never introduce hour estimates.**
- Board columns are declared once in `project.md` frontmatter. Card membership lives
  in each card's `column` + `order`. One source of truth.
- Card `order` uses sparse integers (100, 200, 300). Renumber the column on collision.
- Server modules are plain TypeScript with no React imports.
- A body edit splices under the original frontmatter text verbatim; a frontmatter
  edit leaves the body bytes alone. Never parse-and-rewrite a whole file to change
  one half of it.
- **Every write carries `expectedMtimeMs`.** It is required by the route schema, not
  optional — an optional precondition is a last-writer-wins clobber waiting to happen.
- **All writes to one file share one baseline.** Components that write the same
  document go through `ProjectDocProvider`, which owns the mtime and serialises
  requests. Never give a second component its own baseline for a file another one
  already writes.
- **Mutating routes go through `route(handler, { mutating: true })`**, which applies
  the loopback + Sec-Fetch-Site + Origin guards. No auth does not mean no boundary:
  any page in the browser can reach 127.0.0.1.
- Do not import Next's generated `PageProps`/`LayoutProps`; they are excluded from the
  program on purpose. Type route params by hand.
- **Never copy server data into `useState`.** `useState` ignores a changed initial
  value, so the component freezes at first render and no `router.refresh()` ever
  reaches it. Hold optimistic *overrides* keyed by id and derive the rendered value.
- **Reset child state by remounting with a `key`**, never by calling `setState` in an
  effect body.
- **Any third-party component that generates ids must be given a stable `id`.** dnd-kit
  counts from a module-level global and hydrates mismatched without one; the guard is
  `tests-e2e/console.spec.ts`, which fails on any console error.
- The client never computes a card `order`. It sends column + index; the arithmetic
  lives in `lib/ordering.ts` on the server.
- **Anything read by a page must not throw on a transient filesystem state.** Guard the
  `JSON.parse` too, not only the `readFile` — a file caught mid-write is truncated, and
  a throw in a layout or page takes down the whole screen.
- **`atomicWrite` retries `rename` on EPERM/EACCES/EBUSY.** Windows fails the rename
  whenever another process holds a handle to the destination; that is normal, not an
  error. Do not remove the retry.
- **Apply order is snapshot → write → commit, always.** A snapshot taken afterwards
  protects nothing, and a commit taken first records a state that does not exist.
- **The apply route re-reads the proposal from disk.** The browser says *which* blocks
  were accepted, never *what they contain* — otherwise review would be advisory.
- **`lib/git.ts` can never fail an apply.** It returns a reason and the caller carries
  on. Stage explicit paths; never `git commit -a`.
- Do not parse command output by character offset. `git status --porcelain` has a
  two-character status field with a variable-width separator; strip and trim instead.
- **The vault index must stay cheap.** The rail renders in the root layout, so every
  page pays for `listProjects()`. Reads are concurrent and deduplicated by an in-flight
  map; do not reintroduce a serial loop or a second directory walk.
- **Playwright workers are pinned to 2.** Every worker drives one shared Next dev
  server on a 4-core box; the default is derived from core count, which made the
  suite's outcome depend on ambient machine load. Raise it only with measurement.
- A UI component must not unmount itself before reporting what it did. Closing a pane
  or clearing state in an `onApplied`/success handler destroys the confirmation the
  user needs. Three separate bugs of this shape have shipped and been caught.
- **A view keeps the same `data-testid` when it is empty.** "Which screen am I on"
  must not depend on whether the screen has content.
- The decision log is prepend-only and dated server-side. There is deliberately no
  PATCH or DELETE route for it: an entry you can revise later cannot record what was
  thought at the time.
- **Never render vault prose as HTML.** No `dangerouslySetInnerHTML`, no markdown-to-HTML
  pipeline on vault content — it can come from an accepted AI proposal. Use
  `components/ui/Prose.tsx`, which renders tokens as React elements.

### Development

- Run: `pnpm dev` (or `groundwork.cmd`) → http://127.0.0.1:4848
- Lint: `pnpm lint` · Typecheck: `pnpm typecheck`
- Unit: `pnpm test` (vitest) · E2E: `pnpm test:e2e` (Playwright, port 4849)
- E2E runs against `tests-e2e/fixture-vault`, never your real vault, via
  `GROUNDWORK_VAULT`. It also uses its own `GROUNDWORK_DIST_DIR` because Next 16
  refuses a second `next dev` per build directory — without that, having the app open
  on 4848 would block the whole suite.
- Gates: `node scripts/blueprint-lint.js <files>` and `node scripts/fs-boundary.js
  <files>` run automatically on edit via `.claude/gates.json`.
- The vault is git-tracked separately — every AI apply should be worth about one
  reviewable commit of diff. If it's more, the proposal was too coarse.

### Commit Preferences

- Do NOT add "Co-Authored-By" lines to git commit messages.

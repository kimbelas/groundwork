# Finish v1 — plan of record (2026-08-21)

**Status: complete (2026-08-21).** Every box below is checked. P3 (repo-grounded
planning), P8a (export) and P8b (the design audit) all shipped, the docs no longer hide
the repository track, and the final gate passed quiet: 657 unit tests, 238 e2e, lint,
typecheck, both gates, retrieval numbers unmoved. One item was deliberately not run and is
written up under T13 — the live-model walk of the roadmap's verification script.

Nine commits, `e347ae8`..`830c1bb`. What this plan was for:

Everything left between here and "v1 done": P3 (repo-grounded planning), Phase 8
(export + design audit), and the doc drift that hides the P-track. Worked through by
`/finish-v1`, one task per loop iteration, with e2e batches running in the background
per the protocol below.

**Why P3 is the shape it is:** a spawned run is never told where the repo is
(`assertInstructionScoped`, `lib/ai/scope.ts` carries the argument). So integration is
app-side: retrieve in-process via `lib/index/retrieve.ts`, write excerpts into the run
directory, and verify citations against the bytes this process wrote. Do not weaken
that guard to make any task below easier — the correct implementation never needs to.

---

## Protocol

### Loop mechanics

- One task per iteration. Take the first unchecked `[ ]` below, do it fully, run its
  verification, check it off with a one-line result note, move on.
- Blocked task: write the reason next to it, skip to the next. Never silently narrow a
  task's scope — split it into sub-boxes instead so the remainder stays visible.
- Commit coherent units, subject lines in the style of the existing history. No
  Co-Authored-By lines.
- After changes to `lib/`, `app/` or `components/`: run the `invariant-guard` agent on
  the diff. Before declaring a phase (P3 / P8a / P8b) done: run `phase-warden`.
- All CLAUDE.md invariants apply. The ones this work will brush against most:
  undefined-vs-null in patches, guard-needs-a-test-at-its-call-site, every-e2e-spec-
  owns-its-fixture, drawer-for-working-modal-for-deciding, words-on-screen-codes-in-
  files, never-render-vault-prose-as-HTML.

### Background e2e protocol

The suite is ~7 min and the box has 4 cores. Batches run **in the background, one at a
time** (they share port 4849 and `.next-e2e` — two batches cannot coexist), rotating
while implementation work continues in the foreground.

Batches (each re-runs `warmup.setup.ts`; that is expected):

| # | Command | Status |
|---|---------|--------|
| 1 | `ai + index + repo + export` | **green — 55** (final gate, quiet) |
| 2 | `board + columns + drawer + brief-editor + console` | **green — 57** (final gate, quiet) |
| 3a | `dashboard + navigation + new-project + questions` | **green — 43** (final gate, quiet) |
| 3b | `roadmap-log + links-search + design-system` | **green — 83** (final gate, quiet) |

All 16 spec files are covered by those four batches: 238 tests including one warmup each,
so 234 real tests. **Seven spec files in one batch is too heavy for this box** — the first
attempt at batch 3 ran seven and lost `roadmap-log`'s mtime-conflict test to contention,
which passed 24/24 when re-run alone. Three to five specs is the working size.

Rules, all from scar tissue in CLAUDE.md / `docs/06-roadmap.md`:

- **Start of each iteration:** if a background batch finished, read its result before
  doing anything else and update the table. Then, if no batch is running, launch the
  next batch whose relevant code has stabilised (don't run batch 1 while mid-rewrite of
  the AI layer — it can only report noise).
- **Background results are advisory.** This box gives unreliable e2e results under
  parallel load — that's a documented finding, and running in parallel anyway is a
  deliberate trade for wall-clock. A background failure is a *lead*: re-run just the
  failing spec on a quiet moment before treating it as a regression. A single 60s
  timeout on a cold `.next-e2e` is the compile, not the code — re-run before believing it.
- **A killed batch poisons the next.** After killing one: `taskkill /PID <pid> /F` on
  the 4849 listener, then remove `.next-e2e`. The PID is printed by the next `next dev`
  that refuses to start.
- **Read what actually ran.** A warmup failure means ~180 tests never ran and the
  summary says `1 failed`. Count the passes, not just the failures.
- **The final gate re-runs everything quiet** — background greens are for steering,
  not for sign-off.
- Unit tests (`pnpm test`) are fast: run them in the foreground, targeted per task
  (`pnpm test <file>`), full at commit points.

---

## Phase P3 — planning grounded in the code

The payoff for P1 + P2. Exit criteria: a synthesize run on a repo-connected project
produces cards citing `file:line` with exact quotes; an invented citation is flagged in
the diff review; a project with no repo (or no index) behaves exactly as today.

- [x] **T1. Excerpt builder** — new `lib/ai/context.ts` (server-only, no React).
  Given a job + project: no `repo` in frontmatter → `null`, run unchanged. Repo but no
  index ever built → `null` plus a reason the run record can surface. Otherwise derive
  a small query set (synthesize/critique: brief title + section headings + first line
  per section, cap ~6; enhance-card: card title + acceptance criteria lines), call
  `search()` from `lib/index/retrieve.ts` (hybrid; it already degrades to keyword-only
  and says so), dedupe, cap ~8 excerpts / ~6 KB. Write
  `context/repo-excerpts.md` into the run dir **through `lib/runs.ts`** (it owns
  `.groundwork/runs/`): per excerpt, `citation(chunk)` header + fenced verbatim chunk
  text. Headers are repo-relative; **the repo's absolute path must not appear anywhere
  in the file.**
  *Verify:* unit tests for query derivation, caps, all three degradation branches, and
  an assertion that the written file contains no absolute path.
  **Done (iter 1):** `lib/ai/context.ts` plus `writeExcerpts`/`readExcerpts`/`hasExcerpts`
  in `lib/runs.ts`; 19 tests in `tests/ai-context.test.ts`; the no-leak guard verified by
  disabling the redaction and watching two tests fail. Statuses are codes
  (`no-repo`/`no-index`/`stale-index`/`no-hits`/`included`/`unavailable`) plus prose, which
  is what T7 will store and render.

- [x] **T2. Wire into the run** — `instructionFor`/`prepareRun` in
  `lib/ai/claude-cli.ts`: when excerpts exist, the instruction names the excerpt file
  by its run-dir-relative path (inside the app root, so `assertInstructionScoped`
  passes untouched) and states the citation rule. `assertInstructionScoped` is not
  modified.
  *Verify:* call-site test through the `prepareRun` seam — instruction names the
  excerpt file AND contains no repo path, for a repo-connected project. This is the
  guard-needs-a-test-at-its-call-site rule; the scope guard alone is not the test.
  **Done (iter 2):** 4 tests in `tests/ai-scope.test.ts`, verified by removing the clause
  and watching one fail. The scope guard is unmodified; its allow list gained the excerpt
  path (inside the run dir, beside the proposal path already there).

- [x] **T2b. Somebody has to call it** — a gap in this plan rather than in the code: T2
  covered the instruction, and nothing said who builds the excerpts in production.
  `app/api/ai/run` now calls `buildRepoContext` inside the stream task, before
  `getEngine()`, emitting a progress line either way. In the route rather than an engine
  because both engines need the same answer and the run directory is the channel between
  them.
  *Verify:* `ai.spec.ts` re-run after the change (its step assertions use `toContainText`,
  so extra progress lines are safe).

- [x] **T3. Schema + prompts** — add optional
  `groundedInCode: { path, lines: [start, end], quote } | null` to card, risk and
  assumption schemas in `lib/ai/types.ts`. `undefined` = not provided, `null` =
  honest "inferred" — same contract as `groundedIn`. Update `prompts/synthesize.md`,
  `enhance-card.md`, `critique.md`: cite only from the excerpts file, verbatim; an
  invented citation is worse than an honest null (mirror the existing groundedIn
  language).
  *Verify:* schema unit tests: valid citation, malformed shape rejected, absent key
  survives untouched.
  **Done (iter 2):** `GroundedInCodeSchema` uses `path`/`startLine`/`endLine`/`quote` — the
  field names `CodeChunk` already uses — rather than the `lines: [start, end]` tuple this
  plan guessed at; same information, and a citation now reads like the chunk it came from.
  No `.default()` anywhere in the chain, so absent / null / present stay three answers. All
  three prompts carry the citation rule and a "say when the code contradicts the brief"
  instruction.

- [x] **T4. Grounding for code** — extend `lib/ai/grounding.ts`: each
  `groundedInCode.quote` is verified by plain string match **against the excerpt file
  this process wrote**, never by re-reading the repo — the contract is "bytes this
  process read". Unverified code quotes produce warnings alongside the brief-grounding
  ones, distinguishable from them.
  *Verify:* unit tests — match, mismatch, excerpt file absent.
  **Done (iter 2):** 10 tests. The quote is matched inside the excerpt it CITES, proved by
  pointing the match at the whole file and watching the wrong-attribution test fail.
  Whitespace forgiven, case not — a mis-cased identifier is a quote from memory. Code
  warnings are their own sentence, and the proposal route reads the excerpts back off disk
  rather than re-retrieving them.

- [x] **T5. Fixture engine + e2e** — `lib/ai/fixture.ts`: when the project has a
  connected repo with an index, emit one card citing real excerpt text and one citing
  text the excerpts do not contain — same trick that proves the brief-grounding
  warning fires. The e2e case goes in `ai.spec.ts` (single serial file — the run lock
  makes a second file an invalid scenario, not an isolation problem), with its own
  fixture project and a fixture repo (reuse the machinery `repo.spec.ts` /
  `index.spec.ts` already built, not their fixtures).
  *Verify:* the new e2e case shows the valid citation rendered and the bogus one
  flagged.
  **Done (iter 2):** four cases on their own fixture project (`omicron-grounded`) with its
  own repo and index. The index is **written directly** rather than built through the UI: a
  real build spends up to four minutes loading the embedding model to reach the same
  excerpts, and `index.spec.ts` already covers building. One case reads
  `.groundwork-e2e/runs/*/context/repo-excerpts.md` off disk and asserts the repo path is
  not in it — the leak `assertInstructionScoped` cannot see, because it checks instructions
  and this is a file.

- [x] **T6. Review UI** — `components/ai/ProposalReview.tsx`: render code citations
  (mono `file:line` + quote block, via `Prose`/tokens — never HTML), and a warning
  chip for an unverified code quote, visually distinct from the brief-grounding
  warning. Words on screen via `lib/labels.ts` if any code needs a label.
  *Verify:* asserted inside the T5 e2e case; `design-system.spec.ts` and
  blueprint-lint stay green.
  **Done (iter 2):** the citation is shown rather than tucked into a `title` — it is the
  evidence being judged, and a tooltip cannot be read on a touch screen. Quote scrolls in
  its own box so a long source line cannot widen the page; rendered as a text node. The
  code chip is separate from the brief chip, and a claim citing no code shows no chip at
  all.

- [x] **T7. Staleness is said, not hidden** — the run record notes whether excerpts
  were included, keyword-only, or absent (and why); the run panel surfaces it. A user
  who thinks planning read their code and it didn't will blame the plan.
  *Verify:* unit test on the run record field; visible in the T5 e2e case.
  **Done (iter 2):** `RunRepoContext` on the record — status code, excerpt count, whether
  semantic ranking took part, plus prose. Written **before** the engine starts, so a failed
  run still says what it was working from. Optional, so runs predating this stay readable;
  both asserted.

- [x] **P3 gate** — PASSED (iter 3). 624 unit tests, lint, typecheck, both gates clean.
  E2E: `ai.spec.ts` 31, `index+repo+brief-editor` 26, `design-system+console+links` 64 —
  all after the changes they cover. Reviewed inline rather than by `phase-warden` (no
  subagents this session). Exit criteria met: a repo-connected run cites `file:line` with a
  verified quote, an invented citation is chipped *and* warned about, and a repo-less
  project still produces exactly its three cards with no citation UI. Two deviations, both
  recorded above (field names, directly-written test index) and one addition (T2b). The
  real CLI path is exercised by unit tests on the instruction only — spawning a live model
  in the suite would assert nothing about this app, which is the standing decision for the
  whole AI layer.
  One cleanup found by the review: the proposal route was returning the full excerpt text to
  the browser and nothing rendered it. Removed.

## Docs — write the P-track down

- [x] **T8. Truth up `docs/`** — `06-roadmap.md` status box: Phase 7 shipped, P1/P2
  recorded, P3 recorded when its gate passes, counts refreshed. `01-features.md`:
  sections for repo connection, code index, repo-grounded planning (and move them out
  of "deferred" if implied there). `02-architecture.md` + `04-ai-layer.md`:
  `lib/repo.ts`, `lib/index/`, the scope guard, the excerpt flow, the code-grounding
  rule. The P-track currently exists only in commit messages; docs are load-bearing
  here (CLAUDE.md says read them before architectural changes — they must not lie).
  *Verify:* grep docs for `lib/repo`, `lib/index`, `groundedInCode` — all present;
  no stale "Phase 7 is next".
  **Done (iter 3):** wider than planned, because `02-architecture.md` had drifted past P1/P2
  as well — it listed `lib/ai/proposal.ts` (now `apply.ts`), an `AiEngine` signature two
  changes old, and component names nothing uses. Fixed in the same pass. CLAUDE.md also
  gained four rules P3 established; that was not in this plan and should have been.

## Phase P8a — export the agent-ready spec (feature I1)

The first thing in the app that **writes** outside both the vault and the app root, so
it does not inherit the `lib/repo.ts` exception (whose whole argument is "never writes").
It needs its own contract, stated and enforced.

- [x] **T9. `lib/export.ts`** — composes `CLAUDE.md` + a task checklist from brief,
  phases, cards. Contract: writes **only those two filenames**, only into a directory
  the user explicitly chose, never deletes, and always returns a preview/diff before
  any write is authorised. Update `scripts/fs-boundary.js` for the third exception and
  add `tests/export.test.ts` enforcing the discipline the way `tests/repo.test.ts`
  does — a static scan that fails on any delete/rename call or any write outside the
  two names. Record the exception argument in CLAUDE.md **in the same commit** (the
  rule says: don't add a third exception without the argument).
  *Verify:* the new test fails when a forbidden call is added (try it, then remove it).
  **Done (iter 4):** `EXPORT_FILES` is two constants and `writeExport` iterates *them*, so a
  caller naming `../escaped.md` writes nothing (asserted). The fs-boundary gate refused the
  file first, which is the gate working. `rm`/`rename` could not be banned outright — the
  write is temp-then-rename, which is what stops a failed write from having already
  truncated the user's file — so the scan requires every such call to be on `tmp`; verified
  by adding `fsp.rm(dest)` and watching it fail. 28 tests.

- [x] **T10. Route + UI** — `app/api/export` through `route(handler, { mutating: true })`.
  Composing/previewing is a Drawer (working); "overwrite the existing CLAUDE.md?" with
  the diff is a ConfirmDialog (deciding). Escape through `lib/dismiss.ts`. The
  component must not unmount before reporting what it wrote and where.
  *Verify:* unit tests for compose; manual pass at 390px.
  **Done (iter 4):** `POST /api/export` with `confirm:false|true` — one endpoint, two steps,
  both recomposing from the vault so the browser says *where* and *whether*, never *what*.
  Drawer to choose and preview, ConfirmDialog to replace, showing the first 24 lines of what
  would be lost. 390px covered by a new e2e case rather than by hand (see T12).

- [x] **T11. e2e** — new `tests-e2e/export.spec.ts`, own fixture project, exporting to
  a temp dir; covers preview → confirm → files exist, and the no-clobber-without-diff
  path.
  *Verify:* spec green, run solo first, then within a batch (added to batch 1, not 3 —
  it belongs with the other filesystem-heavy specs).
  **Done (iter 4):** 7 cases, own fixture project (`pi-exportable`), fresh temp folder per
  test. Covers preview-writes-nothing, the overwrite confirmation and its cancel path,
  Escape closing only the dialog, a missing folder not being created, the vault being
  refused, and a cross-site POST being refused.

- [x] **P8a gate** — PASSED (iter 4). 652 unit tests, 7 new e2e, tsc, eslint, both gates.
  Reviewed inline. Docs updated in the same commits: `01-features.md` I1 rewritten,
  `02-architecture.md` gained the fourth exception and lost its "(not built yet)" note,
  CLAUDE.md gained the contract.

## Phase P8b — design audit

- [x] **T12. Full-screen sweep** — every screen against the anti-pattern list in
  `docs/05-design-system.md`; every screen at 390px (columns stack, rail is a drawer,
  dashboard table becomes cards); pinch-zoom never disabled; no sub-12px type, no
  sub-32px measured controls; `node scripts/blueprint-lint.js` across all `.tsx`/`.css`.
  Every fix ships with its guardrail + doc change **in the same commit** — that rule
  exists because it was violated once and this file inherits it.
  *Verify:* blueprint-lint on the full tree, `design-system.spec.ts`, `console.spec.ts`.
  **Done (iter 5):** whole-tree blueprint-lint clean over `app/`, `components/`, `lib/` and
  `tests-e2e/`. Three things came out of it:

  1. **A new linter rule: tokens that do not exist.** `var(--ink-2)` had shipped into
     `globals.css` during T10 — no such token, CSS resolves it to nothing, the page looked
     fine. Five tests, and the two `next/font` variables are read out of `app/layout.tsx`
     rather than hard-coded, which mattered immediately: the first version of the rule
     flagged the whole stylesheet.
  2. **The export drawer is audited.** Same blind spot the column manager had — a drawer
     only exists once opened, so nothing that walks a loaded page measures it. Now checked
     for hue, type floor, tap floor, and overflow at 390px, including its error state.
  3. **A finding that was not one.** That 390px test reported the drawer 11px past the
     viewport. I "fixed" `min(480px, 100vw)` → `100%`; the number moved to 7px, which should
     have been the tell. It was the 160ms slide-in from `translateX(16px)` — the test was
     sampling mid-animation. It now waits for animations to finish, `100vw` passes, and the
     CSS change is reverted: `globals.css` is byte-identical to before. The
     vw-counts-the-scrollbar concern is real in principle and **not reproducible in this
     harness**, which has no classic scrollbar at that width. Left unfixed on purpose rather
     than fixed on a story.

  Also excluded `tests/design-lint.test.ts` from the blueprint gate. It tests the linter by
  execution, so it holds `#6366f1`, a display face and 4px type as fixtures — the gate fired
  two dozen times on the one file whose violations are the point. Pre-existing; found by
  running the gate over the whole tree.

## Final gate

- [x] **T13. Quiet, full verification** — PASSED, with one item deliberately not run.

  | Check | Result |
  |---|---|
  | `pnpm test` | **657 passed**, 31 files |
  | `pnpm typecheck` | clean |
  | `pnpm lint` | clean |
  | `scripts/fs-boundary.js`, whole tree | clean |
  | `scripts/blueprint-lint.js` over `app` + `components` + `lib` + `tests-e2e` | clean |
  | E2E, four quiet batches | **238 passed** (55 + 57 + 43 + 83), zero failures |
  | `pnpm eval:retrieval` | unchanged from P2 — see below |

  Retrieval numbers, identical to the ones the P2 commit recorded, which is what this gate
  asks (chunking, tokenizing, stopwords and fusion all changed hands this session only via
  code that does not touch them):

      exact-term    keyword 100% (MRR 1.000) · semantic 100% (0.903) · hybrid 100% (0.958)
      paraphrase    keyword  40% (MRR 0.400) · semantic 100% (0.650) · hybrid  80% (0.800)

  **Not run: the live-model half of the roadmap's end-to-end script (steps 3, 4, 5, 7).**
  Those need a real `claude` spawn per run, they spend the user's quota, and what they
  actually test is prompt quality — which `docs/06-roadmap.md` itself says is judged by hand
  against `fixtures/briefs/`. Two things follow that a reader should know:

  - The real CLI path is the one surface the fixture engine cannot vouch for, and P3 changed
    both `instructionFor` and all three prompt files. The instruction text is asserted by
    unit tests through the `prepareRun` seam and the excerpt mechanics by e2e, but **no live
    model has read the new prompts.** That is the first thing to do with a spare five
    minutes: connect a repo, build the index, run Synthesize, and read whether the citations
    come back real.
  - The steps that need no model are already covered: 6 (drag persists) by `board.spec.ts`,
    8 and 9 (revert, and a missing `vault/.git` not blocking a write) by `ai.spec.ts` and
    `tests/git.test.ts`, 10 (survive a closed tab) by `ai.spec.ts`.

  Reviewed inline throughout rather than by `phase-warden` / `invariant-guard`: this session
  is configured not to spawn subagents unless asked. A fresh-context review of the whole
  three-phase diff is still worth having and has not happened.

---

## Iteration log

(One line per loop iteration: what was done, what was launched in background, anything
surprising. Prepend-only.)

- **iter 6** — final gate. All four batches quiet and green (55/57/43/83), 657 unit tests,
  both gates over the whole tree, retrieval numbers identical to P2's. The first batch-3
  attempt ran seven specs and lost one mtime-conflict test to contention; it passed 24/24
  alone, and the batch was split rather than the result waved through. Plan closed.
- **iter 5** — T12 done (a3716a5) plus the gates.json exclude. The 390px "overflow" was my
  own test sampling mid-animation; the CSS fix it prompted is reverted, and the episode is
  written up above because a fix that fixes nothing is worse than no fix. Final gate started.
- **iter 4** — T9 (24d5a69), T10 + T11 (87ac6e4), P8a gate passed. The fs-boundary gate
  refused `lib/export.ts` on sight, which is the gate doing its job; the exception now
  carries its own contract and its own scan. 652 unit tests.
- **iter 3** — T5, T6, T7 (committed 47f9d89), T8 (356c3a3), P3 gate PASSED. Docs drift was
  worse than this plan assumed: `02-architecture.md` described an `AiEngine` signature two
  changes old and a module renamed long ago. E2E green on everything the changes touch:
  31 + 26 + 64.
- **iter 2** — T2, T2b, T3, T4 done and committed (da38f38). Batch 1 green (45) against
  T1. Found a hole in this plan: nothing assigned the production call to
  `buildRepoContext`, so T2b now exists. The slop-guard hook rejected two doc comments on
  phrasing alone — reworded, no code change. 622 unit tests.
- **iter 1** — T1 done. Batches 2 and 3 green in background. Two things worth knowing:
  `ProjectMeta` has `name`, not `title` (caught by typecheck, not by a test). And the
  `invariant-guard`/`phase-warden` steps are being done inline rather than by spawning
  those agents — this session is configured not to spawn subagents unless asked, so ask
  before the P3 gate if a fresh-context review is wanted.

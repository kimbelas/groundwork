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
  what lets the spawned CLI hold write access to one directory only.

  **`lib/repo.ts` is the second exception**, granted on the same argument one step
  weaker: it owns a third tree (a connected repository), never resolves inside
  `vault/`, and never writes at all. Routing repo reads through `lib/vault.ts` would
  keep the letter of the rule and lose its reasoning — that module's whole contract is
  "every path is anchored at the vault root", and a function there that deliberately
  resolves elsewhere would make containment depend on which function you called. The
  read-only claim is enforced by a test, not a comment: `tests/repo.test.ts` fails if
  any writing `fs` call appears in that file. Do not add a third exception without the
  same argument.
- **A spawned AI run is never told a path outside the app root.** Its permissions are
  a **denylist** in `.claude/run-settings.json` whose globs are relative to that root,
  and `--allowedTools` grants `Write` broadly because the CLI does not honour a
  path-scoped *allow* rule. So a path outside the root is not merely unlisted, it is
  unprotected. A connected repo lives outside it by definition, which is why the app
  reads the repo itself through `lib/repo.ts` and puts the excerpts in the run
  directory — the run never learns where the repo is. `assertInstructionScoped` in
  `lib/ai/scope.ts` enforces this on every spawn, because the breach is a single
  plausible edit: adding "the repo is at <path>" to a prompt.
- **The AI never writes into `vault/`.** It writes a proposal JSON to
  `.groundwork/runs/<runId>/proposal.json`. The app validates it with zod, shows a
  diff, and applies it only on user accept — after snapshotting. Enforced by the denylist
  in `.claude/run-settings.json`, passed to the spawned CLI with `--settings`:
  `Edit(vault/**)`. Spelled `Edit`, because only `Edit(path)` rules take part in file
  permission checks and they cover Write too; a `Write(path)` rule is ignored with a
  startup warning, and eleven of them once outweighed the stderr tail kept for a failed
  run's real error.
- **A write refuses frontmatter that did not parse.** `readData` swallows a YAML syntax
  error and returns `{}` so one bad file stays one bad file instead of killing a page —
  correct on the read path, destructive on the write path, where it means the
  preservation pass carries nothing and zod fills in defaults. One click replaced
  everything a user had typed with fabricated values. Both patch functions call
  `hasBrokenFrontmatter` and throw `invalid_document`; the file needs a human.
- **`lib/export.ts` is the fourth exception, and the only one that writes outside this
  app.** The other three are `lib/runs.ts`, `lib/index/store.ts` and `lib/repo.ts` — two own
  a directory inside the app root, and the third owns a tree it *never writes to at all*,
  which is the whole of that argument and export cannot borrow it. So it carries its own contract: exactly two filenames (`CLAUDE.md`,
  `TASKS.md`), both constants in the module and neither taken from a caller; into an
  **existing** directory only, never created, because a typo should fail rather than scatter
  files; the vault and this app's own tree refused in both directions, subdirectories
  included (the near-miss is this app's own root — it would overwrite the instructions this
  app runs under — and `<app>/lib/CLAUDE.md` is the same failure one level down, since agent
  tooling reads it as instructions for that subtree); nothing
  deleted or renamed but its own temp file; and a preview of what would be overwritten
  before anything is — **carried as a precondition, not a courtesy.** `writeExport` refuses
  to replace a file the caller has not said it showed the user, because "never clobbers
  without showing the diff" has to survive the gap between the showing and the writing.
  Same argument as `expectedMtimeMs`, and the browser's list fails closed: absent means
  nothing was acknowledged. `tests/export.test.ts` scans the source and fails if any of that stops
  being true — verified by adding a delete and watching it fail. Do not add a fifth
  exception without the same kind of argument *and* the same kind of test.
- **The repo index is derived data and never authoritative.** It lives in
  `.groundwork/index/` (git-ignored), is rebuildable from the repo, and anything wrong
  with it is answered by rebuilding — so every read returns `null` rather than throwing.
  The vault stays the only source of truth. Derived data never gets committed as prose.
- **The excerpt file is the whole channel between a repo and a run, and it must not name
  the repo.** `lib/ai/context.ts` writes
  `.groundwork/runs/<runId>/context/repo-excerpts.md` and the instruction names *that file*,
  never a location. Chunk paths are repo-relative by construction, but chunk **text** is
  arbitrary source and a repo can contain its own absolute path — a config, a committed log,
  a comment — and that file is a legitimate retrieval hit. So the repo path is redacted from
  every excerpt, both separator spellings, case-insensitively, before anything is written.
  `assertInstructionScoped` does not cover this: it checks instructions, and this is a file.
  `tests/ai-context.test.ts` does, and an e2e case reads the real run directory.
- **A code citation is verified against the excerpts, never against the repo.** Re-reading
  the repo would check a different thing than the one asked — the model saw the excerpt
  bytes — and would mark honest citations false the moment you save a file, which is the
  opposite of an audit trail. The quote must appear **in the excerpt it cites**, not
  anywhere in the file: quoting file A while citing file B is the shape a plausible wrong
  answer takes. Whitespace is forgiven, case is not; `orderFor` and `orderfor` are
  different symbols.
- **`groundedInCode` has three states and no `.default()`.** Absent means the run had no
  code to cite, `null` means the code was read and settled nothing, an object is a claim the
  app will check. A default would consume `undefined` and turn silence into a citation — the
  `undefined`-means-not-provided bug, arriving in the one field where it fabricates
  evidence.
- **Repo grounding can never fail a run, and must never degrade silently.** Same rule as
  `lib/git.ts`: a missing index, a moved repo, an unloadable model each return a status and
  prose, and the run proceeds on the brief. But the review says which of the six outcomes
  happened, because a reader who believes the plan was checked against their code when it
  was not will trust it further than they should.
- **Retrieval quality is guarded by a number, not an opinion.** `tests/index-eval.test.ts`
  gates keyword recall@5 and MRR over a fixed corpus; `pnpm eval:retrieval` loads the model
  and prints keyword / semantic / hybrid side by side. Any change to chunking, tokenizing,
  stopwords or fusion has to keep those numbers, because retrieval has no compile error —
  it just gets quietly worse and shows up later as planning that cites the wrong file.
- **The eval corpus contains prose, and deleting it is the way to hollow out that gate.**
  The corpus was written from code alone, and so could not reproduce a failure already seen
  on the first real repository: `README.md` took rank one on *every* citation a live run
  produced, because a document naming every subsystem matches more distinct query terms than
  the twelve lines that answer the question. Length is now discounted in
  `lib/index/keyword.ts` (`LENGTH_NORM_B`, BM25's `b`), which recovers eight of twelve
  queries — but the durable half is `PROSE` in `tests/fixtures/retrieval-corpus.ts`, because
  a corpus that cannot reproduce a production failure measures the wrong thing. A test
  asserts those files still contribute chunks.
- **A retrieval change states its cost as well as its win.** The length correction bought
  keyword MRR 0.625 → 0.958 on exact terms and *cost* hybrid MRR 0.467 → 0.367 on
  paraphrases, where the keyword half has almost no signal and normalising it only reshuffles
  what it contributes to fusion. Recall held at 80%. Both numbers are recorded in
  `docs/06-roadmap.md`; a change that reports only the improvement is how the next one gets
  made blind.
- **Snapshot before every apply.** Copy each target file into
  `vault/<slug>/.snapshots/<ISO>/` first. Revert restores the newest snapshot.
- **One AI run at a time**, enforced by a lock file.
- **Auto-commit is bookkeeping, never a precondition.** `lib/git.ts` failing must not
  fail an apply — log it, surface a notice, move on. Stage explicit paths only; never
  `git commit -a`.

### Design rules — do not regress these

The visual language is **Graphite** (see `docs/05-design-system.md`): near-monochrome
neutrals, one accent used only to mark state, one sans and one mono. It follows two designs
that were rejected — one for being too small and cramped, one for being too soft — so the
rules guard comfort without softness.

A previous palette name survived here for a full revision after the CSS had moved on, and
nothing caught it. **A change to the design changes its guardrail — the lint rule, the e2e
assertion and the doc — in the same commit.** Anything less is how the last drift happened,
and this paragraph has itself been stale once, which is the point.

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
  `--surface`, `--line`, `--accent`, or a `--s-*` status hue. Text on the solid accent fill
  is `--on-accent`; the linter's `#fff` exemption that used to cover it is gone.
- **A primitive owns the sizing of what it wraps.** `IconButton` sizes its glyph to 16px in
  CSS, because an inline `<svg>` with only a `viewBox` has no intrinsic size and the drawer's
  close button rendered as an empty square. `Select` (`components/ui/Select.tsx`) wraps the
  native element so the chevron can be an inline SVG sibling — a data-URI background sees
  neither `currentColor` nor the theme tokens. Raw `<select className="select">` is not used
  anywhere; go through the primitive. Both take a required `label`, because the e2e suite
  finds them by name.
- **No indigo, violet or purple** — the generic-AI tell, and the one hue family both
  enforcement layers hunt for. The e2e audit rejects computed hues 240–300 above 0.15
  saturation, so a new accent must sit below 240 or above 300; Graphite's is around 166 and
  its `--s-active` around 214. **No Tailwind cool-grey utility classes** (`slate`, `zinc`,
  `gray`); that rule bans the class names, and the app uses no Tailwind utilities at all.
- **A drawer is where you work; a modal is where you decide.** Editing a card, naming a
  new project, connecting a repo — all use `components/ui/Drawer.tsx`, which slides in from
  the right and deliberately does NOT block: clicking a different card swaps the drawer,
  because the thing you are editing only makes sense next to its neighbours. A destructive
  or irreversible question uses `components/ui/ConfirmDialog.tsx`, which is a native
  `<dialog>` opened with `showModal()` and blocks properly. No `window.confirm` — it cannot
  say where a file goes, and a prompt that cannot explain itself gets clicked through.
- **Escape goes through `lib/dismiss.ts`, never a `window` listener.** One listener, a stack
  of layers, and only the top one is dismissed. Binding your own is how a confirmation over
  a drawer closed both — the user cancelled one thing and lost two. `stopPropagation` does
  not help, because both handlers sit on the same target. This is the fourth bug of that
  shape in this codebase. An inline editor inside a drawer pushes its own layer while it is
  open (`CriterionEditor` in `CardDetail.tsx`), so Escape cancels the edit and the next one
  closes the drawer; never handle Escape on the input.
- **A drawer returns focus to whatever opened it**, captured on the FIRST render via a lazy
  `useState` initializer. Reading `document.activeElement` in an effect is too late: effects
  run child-first, so a field marked `autoFocus` has already taken focus and gets recorded
  as the opener — then closing restores focus to a detached node, which is the same as
  losing it.
- **No emoji in UI chrome.** Use a status chip or an inline SVG.
- **Words on screen, codes in files.** Display "High" and "80% sure" via `lib/labels.ts`;
  the vault keeps `P1` and `0.8` because a person hand-edits those files.
- **One sans, one mono.** There is no display face. A serif ran on titles for two
  revisions on the argument that it stopped the app reading as a generic dashboard; it was
  dropped because the tool this is modelled on uses a single family, and hierarchy comes
  from size, weight and space instead. Both `scripts/blueprint-lint.js` and
  `tests-e2e/design-system.spec.ts` refuse its return, so this is enforced rather than
  remembered. Instrument Sans, not Inter — Inter is what every generated interface reaches
  for, and looking generic is the complaint this rebuild answers.
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
- **A drawer owns one write chain for its file.** `CardDetail` sends body and frontmatter
  writes through `lib/writeChain.ts`, so the mtime each request carries is the one the
  previous write returned, a failure rejects everything queued behind it, and a 409 locks
  the chain until the card is reloaded. Greying controls is not serialisation: two events in
  one tick shared a baseline read from the render closure. This is the card-file half of the
  rule above, as a pure module a unit test can hold to its contract.
- **A checklist edit changes the lines it names and no other byte.** `lib/checklist.ts`
  adds, renames, removes and reorders criteria on `split("\n")` positions: a rename rewrites
  one line's text, a removal splices one element, a move swaps two lines' content and leaves
  each position's `\r`. A missing heading is created at the end of the body, because that is
  the only insertion that leaves every existing byte where it was. The tests assert line
  counts and every untouched line, not just the new text.
- **An AI update never removes or unticks a criterion the user wrote.** `lib/ai/merge.ts`
  keeps every existing task line — bytes, tick, position — and can only append what the
  model added; a criterion the model omitted or reworded is kept and labelled in the review.
  The old apply rewrote the list wholesale and lost every `[x]` the user had ticked. Removal
  is a click in the drawer, by the user. A replacement will arrive only as a per-criterion
  proposal the user accepts row by row (the designed "Sharpen"), never from a bare `update`.
- **An apply carries the baseline the review was computed against.** The review is a diff
  against a card read at review time; the write is against the card on disk at apply time.
  `selection.baselines[cardId]` makes those the same file or a 409, and `applyProposal`
  refuses an update with no baseline. The snapshot is the safety net, not the precondition.
- **A pending proposal is found by job and card, never by "newest ready".** `pendingRunFor`
  in `lib/runs.ts` is the only lookup; `run.json` carries `cardId` for enhance runs so a card
  can find its own. Two job-agnostic `find`s used to exist, and a finished card enhancement
  surfaced on the brief page as a synthesis. The review seed in `EnhanceCard` is state set
  once from the first read — never derived from a refetched list, because the refetch after
  an apply finds nothing pending and would unmount the review in the tick it says "Applied".
- **A run that is still working is found by `activeRunFor`, never by `pendingRunFor`.** They
  answer different questions and must stay apart: `pendingRunFor` is `ready`-only, and letting
  a `running` record through it would open a review against a `proposal.json` that has not
  been written — the same shape as the job-agnostic `find`s above. The brief page asks both.
  This exists because the run deliberately outlives the response that started it: switching
  tabs aborted the stream, synthesis carried on, and the page came back showing **idle buttons
  over a locked project**, so the next click failed on the lock for reasons nobody could see.
  An adopted run shows elapsed time rather than steps — steps are streamed, never stored, and
  the stream belongs to the tab that opened it — because "is it working or hung" is the
  question the step list exists to answer and a bare spinner does not.
- **Account status is asked of the CLI, never read off its files.** `lib/ai/account.ts` runs
  `claude auth status --json` and whitelists the fields it forwards. `~/.claude.json` is a
  cache the CLI does not always rewrite — on this machine it named a different account than
  the CLI did — and reading it would be a fifth `fs` exception, into the user's home. Nothing
  is spawned under the fixture engine, and the answer is cached for a minute so no page pays
  a process per render.
- **Mutating routes go through `route(handler, { mutating: true })`**, which applies
  the loopback + Sec-Fetch-Site + Origin guards. No auth does not mean no boundary:
  any page in the browser can reach 127.0.0.1.
- Do not import Next's generated `PageProps`/`LayoutProps`; they are excluded from the
  program on purpose. Type route params by hand.
- **A patch value of `undefined` means "not provided", never "clear it".** Filter it out
  before merging. `zod`'s `.default()` *consumes* undefined, so a present-but-empty key
  silently rewrites the field to its default — a stage of "building" becomes "idea".
  Only `null` clears, and only where a field is optional (`repo`). This was fixed at one
  call site in `lib/ai/apply.ts` before it was fixed in the writer, which left the next
  caller to rediscover it.
- **A guard needs a test at its call site, not only on its function.** A review replaced
  `assertInstructionScoped(...)` in `lib/ai/claude-cli.ts` with `void
  assertInstructionScoped;` and all 428 tests still passed: the check was correct and
  nothing verified it was installed. `prepareRun` exists as a seam so that is
  assertable. This is the same defect shape as a guard that does not guard, and it is now
  the fourth instance in this codebase.
- **A test that cannot run must skip, not pass.** Four symlink tests began `if (!symlinks)
  return;` and reported green on Windows, where `symlink(..., "dir")` needs elevation —
  disabling both symlink guards in `lib/repo.ts` changed nothing. Use `it.skipIf`, and
  prefer a mechanism that actually runs: a **junction** needs no elevation and takes the
  identical code path.
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
- **Every e2e spec owns its own fixture project.** `repo.spec.ts` borrowed
  `zeta-editable` from `brief-editor.spec.ts`; both reset that file in `beforeEach`,
  `fullyParallel` is on and there are two workers, so they co-scheduled and one reset the
  file under the other. It surfaced as the editor reporting "Changed on disk" — a
  conflict that looked like a real lost-update bug and was two tests fighting.
- **Playwright workers are pinned to 2.** Every worker drives one shared Next dev
  server on a 4-core box; the default is derived from core count, which made the
  suite's outcome depend on ambient machine load. Raise it only with measurement.
- **A cancelled e2e run poisons the next one.** Killing the suite leaves its
  `next dev` alive holding `.next-e2e`, and `playwright.config.ts` sets
  `reuseExistingServer`, so the following run adopts that half-dead server instead of
  starting a fresh one. It surfaced as a 500 on `/p/alpha-portal/log` during warmup —
  a route nothing had touched. After killing a run: `taskkill /PID <pid> /F` on the
  process listening at 4849, then `rm -rf .next-e2e`. The PID is printed by the next
  `next dev` that refuses to start.
- **`warmup.setup.ts` is a single point of failure, deliberately.** It compiles every
  route before the suite, so a broken build fails once instead of 180 times — but a
  failure there means ~180 tests **never run**, and the summary says `1 failed` rather
  than anything about the silence. Read what actually ran before trusting a small
  failure count.
- **The full suite is ~7 minutes and gets killed by long-running-command limits.**
  Running it in spec batches is equivalent and finishes: each batch re-runs the warmup
  setup, so the totals add up to the suite count plus one per extra batch.
- **Three spec files per batch is the working size; four or more is not.** Two workers on a
  four-core box running four specs produced an intermittent first-test failure four separate
  times in one session — and because a serial spec file skips everything behind a failure,
  one lost test hid twenty-three. Every one of them passed on re-run, alone and unchanged. So
  a batch failure is a **lead, not a regression**: re-run the failing spec by itself before
  believing it. Treating contention as a finding wastes an afternoon; treating a real
  regression as contention is worse, and re-running is what tells them apart.
- **Never pipe a background command through `head` or `tail`.** A pipeline exits with the
  *last* command's status, so `pnpm lint | tail -2` reports success while eslint is failing —
  it did, and a commit went out claiming "lint clean" when it was not. The same shape threw
  away the detail of a failing e2e batch, leaving no evidence of which two tests failed.
  Redirect to a file and read the file.
- **A cold `.next-e2e` can time a test out on its own.** The per-test limit is 60s, and a
  first run after the build dir is cleared spends much of that compiling — one board case
  timed out at 60s on a 1.8-minute run and passed on the 1.2-minute re-run with no code
  change. Before calling a single timeout a regression, re-run it; if it passes on a warm
  build dir it was the compile, not the code.
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
- Retrieval evals: `pnpm eval:retrieval` — needs the embedding model, so it is a script
  rather than part of the suite. The keyword floors are gated in `pnpm test`.
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

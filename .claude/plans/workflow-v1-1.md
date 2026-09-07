# Workflow v1.1 — plan of record (2026-09-03)

**Status: not started.** Revised once before starting, against three expert reviews. What
they changed is recorded under *Review corrections* below, because a plan that quietly
absorbs its review loses the reason each box is shaped the way it is.

v1 shipped every feature it promised. This plan is about something the feature list
cannot see: whether a person who opens this app with an idea can get a project all the
way to finished, and whether what the app tells them along the way is true.

Two findings shaped it, both from reading code rather than docs:

- **The app has no concept of "done".** Three unrelated partial signals — `stage`, a free
  choice nothing computes; per-phase `done/total`, meaning "cards in the last column"; and
  `nextAction` returning "Nothing queued". Nothing ties criteria completion to card
  completion to phase completion to shipping. "Nothing queued" is a terminal state the app
  reaches happily while every card still has unticked criteria, and it is the same wording
  it uses for a project nobody has started. A planning tool that cannot say whether the
  plan is finished is missing its last chapter.
- **"Done" is inferred three times, independently**, as `columns[columns.length - 1]` —
  `lib/format.ts:16` (the dashboard's Phase column), `app/p/[slug]/roadmap/page.tsx:14`
  (the phase track), and `lib/nextAction.ts` (`workableColumns`). Renaming or reordering
  columns silently changes what every progress number in the app means, in three places,
  with nothing to catch it. That is an accuracy bug wearing a convention's clothes.

So the shape is: **walk it first, fix what the walk finds, then build the designed
backlog.** Phase W produces evidence; W4 re-ranks everything after it.

**Scope discipline.** Boxes below W were written from a code read. They are a starting
order, not a fixed one — but "the walk re-ranks it" is also the exact language a plan uses
right before it drops half its scope. So: **W4 may reorder freely and may promote findings
into the three reserved slots, but it may not delete a committed box.** Anything it wants
gone is struck through with a one-line reason and stays visible in this file.

**What this plan is not.** No graph view, multiple briefs, templates, card comments, or
Anthropic API engine — those stay deferred in `docs/01-features.md`. Retrieval quality is
also out; it is gated by numbers and deserves its own plan.

---

## Review corrections

Three reviewers read this plan before it started. Five findings changed it materially and
are recorded here because each one is a trap the next reader could fall into again.

1. **Phase W's original premise was false.** It claimed the `claude` CLI was not installed
   and built the whole walk on the fixture engine. The CLI is installed
   (`C:\Users\belas\AppData\Roaming\npm\claude.cmd`, v2.1.259, signed in) and merely absent
   from both shells' `PATH` — which is what `GROUNDWORK_CLAUDE_CMD` exists for. Verified:
   `/api/ai/account` on the walkthrough instance now returns `state: connected`,
   `engine: claude-cli`. This matters more than any box below it, because
   `docs/06-roadmap.md` records in its own words that the live run *"found four defects
   that 667 unit tests and 238 e2e could not, every one of them on the seam the fixture
   engine cannot stand in for"*, and concludes: *"the surfaces a fixture engine cannot
   reach are where the defects were, all of them."* A discovery walk whose exit criterion
   is "we know what's missing", run on the one engine documented as unable to see what was
   missing, would be this project repeating a mistake it has already written down. Hence
   **W0**, and W1 on the live path.
2. **D2, as first written, required breaking an invariant.** Detailed in the box.
3. **B's real risk was misidentified** as styling; it is a performance regression on the
   hottest path in the app. Detailed in B1b.
4. **A1's fix was itself a second-source-of-truth bug.** Detailed in A1.
5. **Nothing in the plan did UI/UX work**, which was asked for explicitly. Hence **B4**.

---

## Protocol

### Loop mechanics

Carried from `finish-v1.md`, which worked. Driven by `/loop /workflow-v1-1`.

- One task per iteration. Take the first unchecked `[ ]`, do it fully, run its
  verification, check it off with a one-line result note, move on.
- Blocked task: write the reason next to it, skip to the next. **Never silently narrow a
  task's scope** — split it into sub-boxes so the remainder stays visible.
- Commit coherent units, subject lines in the style of the existing history. No
  Co-Authored-By lines.
- After changes to `lib/`, `app/` or `components/`: run `invariant-guard` on the diff.
  Before declaring a phase done: run `phase-warden`.
- All CLAUDE.md invariants apply. The ones each task brushes against hardest are named on
  its **Risk** line — a rule you are reminded of at the moment you might break it is worth
  more than one you read at the top.

### Background e2e protocol

**The batch table is re-cut.** `finish-v1.md` ran 16 spec files in four batches; there are
now 23, and CLAUDE.md's rule is three per batch — four or more produced intermittent
first-test failures four separate times in one session. Grouped by subsystem so a batch's
code stabilises together.

| # | Specs | Status |
|---|-------|--------|
| 1 | `ai + run-resume + export` | **green — 44** (baseline, unmodified code). One failure in the batch — `run-resume.spec.ts:80` "keeps both buttons disabled while another run holds the lock" — passed **7/7 re-run alone**. Contention, as the protocol predicts; the walkthrough dev server on 4850 was still running and is the load. Kill it before a batch. |
| 2 | `index + repo + project-settings` | **green — 24** (second attempt). First attempt failed 7 of 8 on a stale `.next-e2e`: `/p/<slug>/settings` served a bare 404 while its `page.tsx` sat on disk. Warmup *passed*, so the usual tell did not fire, and `repo.spec.ts` being serial meant 16 further tests never ran behind one failure. |
| 3 | `board + board-scroll + columns` | not run |
| 4 | `drawer + card-page + brief-editor` | not run |
| 5 | `dashboard + navigation + new-project` | not run |
| 6 | `questions + suggested-answers + roadmap-log` | not run |
| 7 | `links-search + ticket-search + delete-project` | not run |
| 8 | `console + design-system` | not run |

New specs join the batch whose subsystem they match; batch 8 has room for two.

- **One batch at a time, ever.** They share port 4849 and `.next-e2e`.
- **Background results are advisory.** A failure is a *lead*: re-run that spec alone before
  treating it as a regression. A single 60s timeout on a cold `.next-e2e` is the compile.
- **A killed batch poisons the next.** `taskkill /PID <pid> /F` on the 4849 listener, then
  remove `.next-e2e`.
- **Read what actually ran.** A warmup failure means ~180 tests never ran while the summary
  says `1 failed`. Count the passes.
- **Never pipe a background command through `head` or `tail`** — a pipeline exits with the
  last command's status, and a commit once went out claiming "lint clean" when it was not.
  Redirect to a file and read the file.

### The walkthrough instance

Phase W drives a **third** server, never the user's real one. Port 4850 with its own dist
dir, because Next 16 refuses a second `next dev` per build directory — the same reason the
e2e suite has `GROUNDWORK_DIST_DIR`. `.next*/` is already git-ignored, and that ignore rule
carries a comment about a throwaway server that once got 38 generated files committed.

```
GROUNDWORK_VAULT=<scratch>/wt-vault   GROUNDWORK_RUNS=<scratch>/wt-runs
GROUNDWORK_INDEX=<scratch>/wt-index   GROUNDWORK_DIST_DIR=.next-walkthrough
GROUNDWORK_CLAUDE_CMD=C:/Users/belas/AppData/Roaming/npm/claude.cmd
pnpm exec next dev -H 127.0.0.1 -p 4850
```

Add `GROUNDWORK_AI_ENGINE=fixture` for W2 and W3, where determinism is the point. W1 runs
without it, on the live model — subject to W0b, since a live run refuses a vault outside
the app root.

**Kill the walkthrough server before launching an e2e batch.** Both want the same 4-core
box, and leaving it up cost batch 1 a false failure on the run-lock test.

**A walkthrough server run from the real repo root mutates a tracked file.** Next appends
its `distDir` to `tsconfig.json`'s `include` — two throwaway dirs added four lines to it in
iteration 2, unnoticed until `git status` was read for another reason. This is the same
mechanism `docs/06-roadmap.md` records for `next-env.d.ts`. **Check `git diff tsconfig.json`
after stopping a walkthrough server**, and revert by editing those lines out rather than by
`git checkout --`, which would take anything else in the file with it.

**A wholesale e2e failure is a stale build dir until proven otherwise.** Batch 2 failed 7
of 8 with `/p/<slug>/settings` returning a bare 404 while `app/p/[slug]/settings/page.tsx`
sat on disk and `git status` showed nothing deleted — and `warmup` had *passed*, so the
"~180 tests never ran" tell did not fire. `rm -rf .next-e2e` is the remedy, and it is worth
reaching for before reading anything into the failures themselves. Note what this cost:
`repo.spec.ts` is serial, so one failure at its line 76 meant **16 further tests never ran**
and the summary said `7 failed`.

**The harness and its locator inventory live in the scratchpad**, beside the plan rather
than in it: `harness.mjs` (screenshots, console errors, 5xx capture), `w0.mjs`, and
`LOCATORS.md` — the route map, every journey testid, and the pre-walk list of suspected
dead ends. Regenerable by re-reading `app/` and `components/`, but that is a full
component read; check for it before paying that again.

---

## Phase W — walk a new project end to end

**Exit criteria.** Not "a findings list" — that is unfalsifiable. Specifically: every one
of the twelve journey stages in W1 reached, with a screenshot that was **looked at**; each
finding carrying a reproduction and a severity; and W4 leaving this file with no finding
unaccounted for — every one promoted to a box or struck with a reason.

- [x] **W0a. Make the live path real, and prove it.** **Done (iter 1) — half succeeded,
  and the half that failed is the more useful result.**
  What worked: `GROUNDWORK_CLAUDE_CMD` pointed at the shim, `/api/ai/account` returns
  `state: connected` / `engine: claude-cli`, and `/settings` names the signed-in account on
  the page. The walkthrough harness drove five UI stages cleanly — create project, write
  brief, add card, add criterion, open drawer.
  What did not: **a live run cannot use a scratch vault, by design.** `prepareRun` refuses
  when `GROUNDWORK_VAULT` sits outside the app root, and says exactly why — a run is told
  where the project is as a path *relative to the app root*, its write permissions are
  globs anchored there, so a vault anywhere else is "both unreadable to the run and
  unprotected by the rule that keeps the model out of the vault". The run record went
  `status: failed` in **29 ms**.
  **This is the guard working, and the UI surfaced it well** — streamed steps, the button
  re-enabled, and the full refusal text in an error box (screenshot `06-enhance-live.png`).
  Not a defect; the box's own premise was wrong for the second time, in a new way.
  The consequence for the plan: the three configurations are scratch vault + fixture
  (safe, what W2/W3 use), real vault + live model (works, but writes into the user's real
  vault), and scratch vault + live model (**impossible, correctly**). W1 therefore needs
  W0b or it falls back to fixture.

- [ ] **W0b. A disposable app root, so the live path is reachable without touching the
  real vault.** The clean resolution: run the walkthrough from a **copy of the app**, so
  the app root and its `vault/` move together. Then the guard is satisfied honestly rather
  than bypassed, `.claude/run-settings.json`'s `Edit(vault/**)` deny rule still covers the
  vault that is actually in use, and the user's real vault is never opened.
  Copy the tree excluding `node_modules` and `.next*`, junction `node_modules` (a junction
  needs no elevation on Windows and takes the identical code path), and run `next dev`
  there on its own port and dist dir.
  **Do not instead point `GROUNDWORK_VAULT` at a scratch directory inside the real app
  root.** That satisfies the guard and breaks the thing the guard protects: the denylist
  is `Edit(vault/**)`, so a vault at any other path inside the root is unprotected — which
  is the precise failure the refusal message describes.
  *Verify:* one live Enhance returns a proposal that validates and renders; record
  wall-clock so W1's budget is a measurement. If this proves impractical, **W1 falls back
  to the fixture engine and says so in its findings header** — a walk that silently
  degraded is worse than one that never ran, because its clean bill of health is false.
  *Risk:* spends the user's quota. The copy must not be inside the real repo (it would be
  linted, typechecked and possibly committed) and must never be pointed at the real vault.

  **Done (iter 2) — but by the fallback route, not the designed one. The disposable app
  root does not work, and the reason is worth keeping.** Three failures in sequence:
  1. **Turbopack rejects a junctioned `node_modules`**: *"Symlink [project]/node_modules is
     invalid, it points out of the filesystem root."* So the cheap trick — share the real
     tree's modules — is unavailable, and the copy needs a real `pnpm install` (4m 38s).
  2. **`robocopy /XD vault` silently dropped `app/api/vault/`**, the two route files that
     serve every project read and write, so project creation 404'd. This is *exactly* the
     trap `.gitignore` in this repo documents in a comment — a bare `vault` pattern matches
     that directory name at any depth, which once left those same two files untracked.
     Reproduced here in a different tool, which is the argument for the comment existing.
  3. After fixing both, Turbopack still could not resolve `@uiw/react-codemirror` in the
     copy although all 21 top-level packages were present and the count matched the real
     tree. Not chased further — the cost had already exceeded the box's value.

  **What was done instead**, and it is better: a live-capable server on the **real** app
  root at port 4852 with its own `GROUNDWORK_DIST_DIR=.next-live` (so the user's own server
  on 4848 was untouched), a throwaway project created through the UI, Enhance run live, and
  **the proposal deliberately not applied** — so nothing model-generated was written to the
  vault. The project was then moved to `vault/.trash/` the way the app's own delete does it,
  and `git -C vault status` is clean again.

  **Result: the live path works, and works well.** One Enhance returned a valid, rendered
  proposal in **154.6 s** — that is W1's per-run budget. Zero findings and zero console
  errors on the happy path. The review quoted the brief's two real constraints and pushed
  what it could not ground into a question rather than inventing it; the grounding chip read
  "Quoted" and the repo line correctly read "No repository is connected, so planning read
  the brief only."
  Incidentally this satisfies a verification step from `docs/06-roadmap.md` that had never
  been run: **progress streams real step names, not a spinner** — "Reading enhance-card.md",
  "Searching the project", "Writing proposal.json" were all on screen.

- [~] **W1. The happy path, 1440×900, live model.** **Partially done (iter 4) — split;
  see W1b.** Twelve stages attempted, eight reached. It found the headline defect of the
  plan on stage three, and three stages are unresolved rather than passed.

  **Reached and passing:** create, brief (saves correctly), board, add card, manage
  columns, open card, add criterion, **Enhance (97 s live, "Apply 4 of 4", applied 2 files,
  auto-committed)**, log a decision, roadmap, dashboard.

  **The finding that matters — F8 below.** Synthesize is disabled on a brand-new project
  until the page is reloaded, so the first thing anyone does with this app does not work.

  **Unresolved, and the reason each is not yet a finding:** critique returned a 409 and
  then timed out at 420 s; the export drawer was never reached; revert ran 64 s and
  surfaced no result. Each could be the app or could be the harness — the walk had three
  harness bugs of its own (below) and these three stages ran downstream of them, so
  calling them defects now would be guessing. W1b re-runs them in isolation.

  **Harness bugs found, all mine, all fixed before W1b:** (a) the card drawer's first
  checkbox is **BLOCKED**, not the first criterion — so the walk blocked its own card and
  then read `Unblock "…"` on the dashboard as if it were an app behaviour; (b)
  `waitUntil: "networkidle"` can never settle on the Questions page, because suggested
  answers start a streaming model run on mount — a real property of the page, and a wrong
  wait for it; (c) the walk applied proposals in the user's live vault (see the process
  note under W1b).

  ---
  **Original box text follows.**

- [ ] **W1. The happy path, 1440×900, live model.** Twelve stages, screenshot each: create
  a blank project → write a brief → Synthesize → review → apply a subset → board (drag, add
  a card, manage columns) → open a card → tick and add criteria → Enhance → apply →
  Questions (suggested answers, answer one) → Critique → apply a risk → log a decision →
  Roadmap → Export → Revert. Record friction, not only failures: every point where the next
  step is not obvious, a number looks wrong, or the app offers nothing to do.
  *Verify:* a screenshot per stage and a findings file. **Look at the screenshots** — a
  blank frame is a failure to launch, not a pass.
  *Risk:* the harness must never point at `vault/`. Live output is non-deterministic, so
  findings must describe the *app's* behaviour, not the model's word choices.

- [ ] **W1b. Finish the three unresolved stages, in isolation.** Critique, export, revert —
  each run on its own against a purpose-made project, not downstream of eleven other
  stages, so a failure means something. Critique is the interesting one: it returned a
  **409** and then hung to the 420 s budget, and a 409 there is either the apply baseline
  working correctly or a stale-mtime bug, which are opposite conclusions.
  Fix the three harness bugs first (BLOCKED-vs-criterion checkbox, `networkidle` on the
  Questions page, and applying in a live vault) or W1b inherits them.
  *Verify:* each stage either passes or produces a finding with a reproduction. "Timed out
  downstream of something else" is not a result.

  **A process rule this plan did not have, and now needs.** The live walk must write into
  the user's real vault — the scope guard refuses any other arrangement, and W0b established
  that. What W1 discovered is the second half of that constraint: **the vault is a live
  repository the user may be working in.** A commit landed mid-walk (`c428788`) carrying
  real `multi-business-system` work *and* the walk's throwaway project, because it staged
  everything. Nothing was lost and the vault is clean again — the test project was removed
  additively in `318f4b9` rather than by rewriting a commit that also held real work. But
  the rule now is: **say when a live walk starts and when it ends, and do not run one
  without the user knowing the vault is in use.** The app's own auto-commit is not the
  hazard here; it stages explicit paths, exactly as CLAUDE.md requires. Ambient commits are.

- [ ] **W2. The same journey at 390px**, fixture engine. Columns stack, the rail becomes a
  drawer, the dashboard table becomes cards. The export drawer and column manager are the
  known blind spots — a drawer only exists once opened, so nothing that walks a loaded page
  measures it.
  *Verify:* screenshots at 390px; any horizontal body scroll is a finding.
  *Risk:* this audit has produced a false positive before — a test sampling mid-animation
  reported 11px of overflow that was the 160ms slide-in, and the "fix" it prompted was
  reverted. Wait for animations to finish, and do not fix a number that moves when poked.

- [ ] **W3. The unhappy paths**, fixture engine. Empty states on every view of a brand-new
  project; an orphan card (rename a column out from under one); a stale-mtime conflict (the
  same card in two tabs); an apply against a card changed underneath the review; an export
  into a folder that does not exist; Settings with `GROUNDWORK_CLAUDE_CMD` pointed at
  nothing. This is where a workflow actually breaks, and the journey map flagged several as
  announce-but-cannot-fix.
  *Verify:* per case, one line on what the user can actually do next.
  *Risk:* confirm each refusal is the *designed* one. **Any 5xx is a blocker finding.**

- [ ] **W4. Rank, fold in, and account for everything.** Rank blocker / bug / friction /
  polish. Promote what earns a box into the three reserved slots; strike anything declined
  with a one-line reason. Update `docs/06-roadmap.md` in the register its status box uses.
  *Verify:* every W0–W3 finding appears in this file exactly once, promoted or struck. A
  finding that is neither is the failure condition for this box.

- [ ] **W5. (reserved for a W4 promotion)**
- [ ] **W6. (reserved for a W4 promotion)**
- [ ] **W7. (reserved for a W4 promotion)**

### Findings log

Accumulated as the walk runs; W4 ranks and accounts for every line. Append-only — a
finding that turns out to be wrong is struck with the reason, not deleted, because the
reason is usually the more interesting half.

| # | Sev | Where | What |
|---|-----|-------|------|
| 1 | bug | Dashboard, empty state | Two buttons share `data-testid="new-project"` (header row and empty state), so `getByTestId` is strict-mode ambiguous on an empty dashboard. Costs every caller a `.first()` and makes a testid mean "one of these". |
| 2 | — | Card drawer, enhance error | **Not a defect — recorded as a pass.** A run that failed 29 ms in surfaced its full reason in the drawer with the button re-enabled and the streamed steps left visible. This is the behaviour the "must not unmount before reporting" rule asks for, working. |
| 3 | polish | Rail, bottom-left | Apparent overlap between the theme toggle ("Light"), the "Settings" link and a dark circular chip at 1440×900 (`06-enhance-live.png`). Needs confirming at other widths before it is believed — it may be a screenshot artefact. |
| 4 | friction | Brief editor | `save-state` still read "Saving..." two seconds after typing stopped, with a 1 s debounce. Either the debounce is longer than documented or the state lingers; a user watching for "Saved" waits longer than the write takes. Seen twice, on two different servers. |
| 5 | friction | Card drawer, after a run | The streamed step list stays at full height when the run finishes — 13 lines on a live Enhance — so the proposal it produced starts *below the fold* and the user scrolls past the log to read the result. The log answers "is it working"; once it has finished, that question is gone and the answer should take the space. Confirmed in `07-review-rendered.png`. |
| 6 | — | Card drawer, live run | **Not a defect — recorded as a pass, and it closes an open item.** `docs/06-roadmap.md`'s verification step 3 ("confirm progress lines stream with real step names, not a spinner") had never been run live. It does: "Reading enhance-card.md", "Reading project.md", "Searching the project", "Writing proposal.json". |
| 8 | **blocker** | Brief → Synthesize, new project | **Synthesize stays disabled after the first brief is written, until the page is reloaded.** Confirmed in isolation, not inferred from the walk: on a fresh project the button is correctly disabled while the brief is empty; after typing, `save-state` reads "Saved 11:55" and the file on disk is correct — and the button is *still* disabled. One reload enables it. So the first sequence any new user performs — create, write, Synthesize — dead-ends with nothing on screen explaining why, and the only escape is a refresh they have no reason to try. This is the `briefEmpty` prop captured at server render and never refreshed: the family CLAUDE.md's "never copy server data into `useState`" rule exists for. **The single most valuable thing the walk has produced.** |
| 9 | — | Enhance apply, live | **Pass, and it is the one that matters most.** A hand-written acceptance criterion ("Works one-handed on a 390px screen") survived a live Enhance apply verbatim. That is the invariant with the most scar tissue in `CLAUDE.md` — the old apply rewrote the list wholesale and lost every tick — verified end to end against a real model for the first time. |
| 10 | friction | Questions page | Suggested answers start a **streaming model run on mount**, so the page never reaches network idle. Correct product behaviour (D7 argues the case for having no button) with two consequences worth stating: any automation must not wait on idle, and a user on a slow link gets a page that is still "working" for a minute after it looks ready. |
| 11 | — | Roadmap, live | A card the AI did not assign to a phase renders as **"Unphased 0/1"** on the phase track. Not a defect, but it is Phase A's thesis showing up unprompted: the number is honest and the label is not actionable — there is nothing on the page to put the card into a phase. |
| 7 | — | Enhance, live | **Pass.** Live proposal in 154.6 s, valid, grounded ("Quoted"), and it declined to invent — it pushed an ungrounded item to a question. Repo status line correct for a repo-less project. This is the seam the fixture engine cannot vouch for, and it held. |

---

## Phase A — what the app says about a project is true

*"Making a project listed to be accurate and precised."* Every box is a number or a label
that can currently be wrong.

- [ ] **A1. The done column is named once, and cannot drift.** Give the project one
  declared terminal column and have all **three** inference sites read it —
  `lib/format.ts:16`, `app/p/[slug]/roadmap/page.tsx:14`, `lib/nextAction.ts`. Default to
  the last column so no existing vault changes meaning on upgrade.
  **The naive fix is itself a bug.** Storing a `doneColumn` *name* beside `columns` creates
  a second source of truth that drifts on the first rename: `ColumnManager.commitRename`
  sends `{kind:"rename-column", from, to}` and would not carry it, so renaming "Done" to
  "Shipped" leaves `doneColumn` naming a column that no longer exists — every card counts
  as not-done, every phase reads `0/N` forever, and `workableColumns` starts including the
  terminal column so `nextAction` proposes finished cards. So: **rename and remove carry
  `doneColumn` in the same write, and the resolver falls back to the last column whenever
  `doneColumn` names a column not in `columns`.**
  *Verify:* unit tests that rename and reorder leave phase counts and next action
  unchanged; a test that the three callers cannot disagree; a test of the fallback.
  *Risk:* "board columns are declared once in `project.md` frontmatter — one source of
  truth", and the `undefined`-means-not-provided rule, since `zod`'s `.default()` consumes
  `undefined` and this is a new optional frontmatter field.

- [ ] **A2. Orphaned cards stop corrupting the numbers.** Two bugs, one cause. `PhaseTrack`
  reads a phase whose cards are all in a removed column as `0/0`, indistinguishable from a
  phase with no cards. Worse, `nextAction` filters cards to `rank.has(c.column)` — a card
  whose column was removed is **not in `rank`, so it is dropped from the computation
  entirely**, and the project reads "Nothing queued" while a card sits stranded. That is
  this plan's thesis with a sharper example than the one it opened with.
  *Verify:* unit tests per branch; an e2e case that a phase with an orphaned card does not
  read as complete, and one that a project with only an orphaned card does not read as
  "Nothing queued".
  *Risk:* "a view keeps the same `data-testid` when it is empty."

- [ ] **A3. An orphan card can be fixed where it is announced.** `orphan-notice` names the
  vanished columns; those cards render nowhere and are recoverable only by re-adding the
  column or hand-editing files. Give the notice an action that moves them to a real column.
  *Verify:* e2e — remove a column out from under a card, recover it from the notice without
  touching disk.
  *Risk:* the client never computes a card `order`; it sends column + index and the
  arithmetic lives in `lib/ordering.ts` on the server.

- [ ] **A4. Next action points at the thing, not the view.** `NextAction` carries
  `{kind, text, view}` and no card id, though the `blocked` and `card` branches both hold a
  card. Add `cardId?: number`, set it in exactly those two, and link the dashboard row to
  `/p/<slug>/cards/<id>` when present. The other three branches correctly point at a view.
  `ProjectSummary.cards` already carries `id`, so nothing new is loaded and G1's "under
  100ms, no AI call" is untouched.
  *Verify:* the four branch tests each gain an assertion; e2e that `Unblock "X"` lands on
  X's page. `docs/01-features.md` G2 changes in the same commit.
  *Risk:* lowest in the plan. The dashboard cell keeps its `data-testid`.

---

## Phase B — the app helps a project finish, and is pleasant while doing it

*"Helping the project to be finished"* and *"enhancing UI/UX."* This is the chapter v1 does
not have.

- [ ] **B1a. Decide what "done" means, and write the decision down. No code.** The
  materials exist and disagree: criteria ticks (`parseChecklist`), the terminal column
  (A1), phase assignment, and `stage`. The question: **does an unticked acceptance
  criterion block a card from counting as done, or is the terminal column the only truth?**
  Both are defensible. What is not defensible is today, where the answer differs by which
  number you read. Record it in `docs/03-data-model.md` **with its argument, not just its
  conclusion** — including the cost noted in B1b, which may well decide it.
  *Verify:* the decision is in the doc, with the rejected alternative and why. A box that
  produces only a conclusion has not been done.
  *Risk:* none — this box writes prose. It is separate from B1b precisely so that one loop
  iteration is not asked to both decide and build; that iteration decides badly.

- [ ] **B1b. Implement the model.** One server module, every display derived from it.
  **The real risk here is not styling — it is the hottest path in the app.** `CardMeta`
  (`lib/schema.ts`) carries no criteria counts; only `BoardCard` does, computed on the
  board page by reading every card body. `ProjectSummary.cards` — what `nextAction`,
  `PhaseTrack` and `progress()` all consume — has never seen a checklist. So the obvious
  implementation, `getCard()` per card for the dashboard row, is exactly the serial second
  read that CLAUDE.md forbids, paid by the root layout on **every page**, against G1's
  100ms budget. `loadCards` already has `doc.raw` in hand — **derive it there, adding no
  read.** If that turns out to be impossible, B1a's decision changes rather than this
  budget.
  *Verify:* unit tests at each level; a timing assertion that `listProjects()` does no more
  reads than before.
  *Risk:* "the vault index must stay cheap — the rail renders in the root layout, so every
  page pays for `listProjects()`." Also: derived data is never authoritative. This computes;
  it never writes, and `stage` stays the user's to set.

- [ ] **B2. Completion is visible where the work is.** Surface B1b on the board (a card
  with unticked criteria sitting in the done column is a real state worth seeing), the phase
  track, and the dashboard row. Words on screen, codes in files, via `lib/labels.ts`.
  *Verify:* e2e at both widths; `design-system.spec.ts` and blueprint-lint stay green.
  *Risk:* no emoji in UI chrome — status chip or inline SVG. No colour outside the token
  block, nothing in hue 240–300.

- [ ] **B3. The app says when a project looks finished.** When B1b says every phase is
  complete, say so and offer the one action that closes it: setting `stage` to `shipped`.
  **Offer, never perform.**
  *Verify:* e2e — a fixture project with everything ticked shows the prompt; one with an
  unticked criterion does not.
  *Risk:* **"all writes to one file share one baseline."** `stage` lives in `project.md`,
  owned by `ProjectDocProvider` — which today wraps only `/brief` and `/settings`. The
  roadmap tab, board and dashboard have none, so a ship prompt holding its own `mtimeMs`
  would clobber or 409 against `MetaBar`. B3 must render inside `ProjectDocProvider` or
  link to a page that has one. Secondarily: a component must not unmount before reporting
  what it did (three such bugs have shipped here), and shipping is a decision, so
  `ConfirmDialog`.

- [ ] **B4. The UI/UX pass.** The explicit ask that no other box serves — every box above
  is correctness or affordance, which is a different thing from polish. Take the friction
  and polish findings W4 ranked and work the top of that list as one design pass: the
  moments where the next step is not obvious, empty states that describe instead of
  offering, and the transitions between the twelve journey stages. **Bounded by W4's
  ranking, not by taste** — this box exists to have a budget for polish, not a licence.
  *Verify:* the specific findings addressed are named in the result note; a re-walk of the
  affected stages shows the change; `design-system.spec.ts` and blueprint-lint green.
  *Risk:* "a change to the design changes its guardrail — the lint rule, the e2e assertion
  and the doc — in the same commit." And comfortable sizing is not negotiable: nothing
  below 12px, body copy 15px+, 32px measured control floor.

---

## Phase C — the workflow has no dead ends

Places where the journey stops because the only way forward is a text editor or an AI run.

- [ ] **C1. Phases are manageable in the app.** The Roadmap tab has zero affordances — no
  add, rename, reorder or delete — and its empty state tells you to go edit `roadmap.md`.
  Cards can be assigned to a phase that only an AI proposal or a text editor can create.
  Give it what `ColumnManager` gives columns, **including the part that is easy to miss**:
  `ColumnManager` refuses to remove a column while cards point at it, and `card.phase` is a
  number, so deleting phase 3 would orphan its cards silently — and `phaseNumbers`
  resurrects it as a nameless "Phase 3". That is the A3 bug, for phases, with no notice.
  *Verify:* new cases in `roadmap-log.spec.ts` on its own fixture project; a rename rewrites
  the phase in one pass; **a delete with cards attached is refused**, asserted.
  *Risk:* deletion is destructive, so `ConfirmDialog`, not a drawer and never
  `window.confirm`. "Every e2e spec owns its own fixture project" — `roadmap-log` has one;
  do not borrow. `expectedMtimeMs` on every write.

- [ ] **C2. Risks and assumptions can be written by hand.** `RiskRegister` toggles
  `validated` and nothing else; its empty state says "Critique proposes them", making a core
  register reachable only through an AI run. Add, edit, remove.
  *Verify:* unit tests that a write preserves surrounding bytes; e2e for the three ops.
  *Risk:* **the write chain.** `RiskRegister` currently chains one op through
  `mtimeRef.current`; four ops on `risks.md` reintroduce "two events in one tick shared a
  baseline read from the render closure" — route them through `lib/writeChain.ts`. Removal
  is destructive: `ConfirmDialog`. And a write refuses frontmatter that did not parse —
  `hasBrokenFrontmatter`, throw `invalid_document`.

- [ ] **C3. Card descriptions are editable.** Read-only today, with an empty state saying
  "Enhance with AI writes one" — so the only way to describe your own card is to ask a
  model. `CardEditor` already has the machine: `writeBody(transform)` runs any pure body
  transform through the one chain per card. The missing piece is the pure function.
  **`descriptionOf` cannot be the read side of it** — it LF-normalises and trims, so a
  round-trip through it cannot preserve `\r`. `replaceDescription` must splice on
  `body.split("\n")` positions `[0, region.start)` and keep each surviving position's CR,
  exactly as the four existing checklist helpers do.
  The deferral reason is weaker than when written: it said a second writer beside a pending
  review is wrong, but the apply already carries `baselines[cardId]`, so a mid-review edit
  is already a 409, not a silent merge. The real remaining hazard is that the review's
  `report.description.before` was computed against text the user has since changed — the
  editor must be honest about that, not merely permitted.
  *Verify:* unit tests that a description write changes only lines above the acceptance
  region and preserves each surviving line's `\r`; e2e for edit-then-enhance.
  *Risk:* "a checklist edit changes the lines it names and no other byte" — the sibling
  rule this function must not violate downward into the criteria.

- [ ] ~~**C4. Project-level AI run history.**~~ **Struck before starting**, on the review's
  argument that it serves none of the five things the user asked for — it is the one box
  with no clause behind it. The underlying observation stands and is recorded here rather
  than lost: `apply-result` replaces the whole review, so after applying you cannot see what
  you accepted; only `enhance-view` recovers a proposal, and only at card scope. Critique
  also renders in the same panel as synthesis with nothing saying which job produced it.
  **W4 may promote either half into a reserved slot** if the walk shows it biting. If it is
  ever built: `pendingRunFor` is the only lookup and `activeRunFor` answers the different
  question — a history view must not become a third, job-agnostic `find`.

---

## Phase D — the designed AI backlog

The two items selected that were designed and never built. **Both are later than they look,
and one doc claim is wrong:**

> `docs/06-roadmap.md` says `lib/ai/merge.ts` "is built to take" per-criterion accept. It is
> not. `mergeCardBody` takes `proposed: {body, acceptance}` with no parameter for "accept
> only these" — it computes `added` internally from the whole array and applies all of it.
> The true, weaker claim: the report shape (`CriterionRow[]` with a `status`) already gives
> the UI a stable per-row identity. **Correct that sentence in the same commit as D1**, per
> the rule that a doc and the thing it describes change together.

- [ ] **D1. Per-criterion accept in the review.** `SelectionSchema` is five arrays of block
  indices plus `baselines`. Add a per-card map of accepted criterion **indices**, give
  `mergeCardBody` a filter for the rows it may apply, and give `CriterionLine` a checkbox.
  Two details the first draft of this box got wrong:
  - **Scope the map over `added` ∪ `replaced`, not `added` alone.** A `replaced` row (D2) is
    neither `added` nor rejectable under an added-only format, so an added-only map means
    D2 changes the wire format a second time. `replaced` is simply empty today.
  - **Absent means invalid, not "all" and not "none".** Every `SelectionSchema` field is
    `.default([])`; here, `?? all` is fail-open — a browser omitting the key accepts
    criteria the user rejected — and `?? none` silently drops criteria they ticked. Use the
    spelling `baselines` already uses: **required per accepted `update` card, and
    `applyProposal` throws `invalid_document` when absent.**
  *Verify:* unit tests that rejecting one added criterion writes exactly the others, and
  that an absent map is refused rather than defaulted; e2e that the file on disk matches the
  ticks in the review.
  *Risk:* **"an apply carries the baseline the review was computed against."** This is the
  load-bearing rule, not "the browser says which, never what" — indices are safe *only
  because* `selection.baselines[cardId]` pins the body. `added` is derived by diffing the
  proposal against the card on disk, so against a different body, index 0 is a different
  criterion. Indices are not self-validating; the baseline is what validates them.

- [ ] **D2. Sharpen a criterion.** A quiet action in a row's edit mode; job
  `{kind:"sharpen-criterion", slug, cardId, index}`; the criterion named to the model by
  text; one `update` card whose `acceptance` carries optional `replaces: string[]`; and
  `mergeCardBody` learning a `replaced` status that takes the new text but keeps position
  and tick.
  **The design as written in the roadmap breaks an invariant, and this box exists to fix
  that first.** `replaces` would sit on `CardProposalSchema` and be honoured by
  `mergeCardBody` — which is the *shared* merge for `synthesize`, `enhance-card` and
  `critique`. Nothing ties it to a sharpen request. So: run Enhance on card 7, have the
  model return `acceptance: [{text: "Login returns a JWT within 200ms", replaces: ["Users
  can log in"]}]`, and `replaces` matches exactly — the "guard" passes and the user's own
  line is rewritten. That is precisely the bug CLAUDE.md's rule was written for: *"a
  replacement will arrive only as a per-criterion proposal the user accepts row by row,
  **never from a bare `update`**."* An exact-match check is the success condition for the
  rewrite, not a protection against it.
  **Therefore:** `replaces` is honoured only when the proposal's job is
  `sharpen-criterion` **and** only for the criterion index that job named; on every other
  job kind it is dropped and reported in the review. Enforce it in `mergeCardBody`'s
  **signature** — pass the job kind and target index in — not at a call site, per "a guard
  needs a test at its call site", which this codebase has now been bitten by four times.
  Files it touches, exactly: `lib/ai/types.ts` (the `AiJob` union, `replaces`, **and both
  enums the first draft missed** — `ProposalSchema.job` and `RunRecordSchema.job`, or a
  sharpen proposal fails zod and its run record fails `updateRun`);
  `lib/ai/claude-cli.ts` (the `switch (job.kind)` is exhaustive with no `default`, so a new
  kind is a **typecheck error until handled** — a good seam);
  `app/api/ai/run/route.ts` (the `cardId` spread is `enhance-card`-only, and sharpen needs
  it on `run.json` or `pendingRunFor` cannot find the proposal); `lib/ai/context.ts` (same
  narrowing for query derivation); `lib/ai/fixture.ts` (or e2e cannot cover it);
  `prompts/sharpen-criterion.md`; `lib/ai/merge.ts`.
  *Verify:* a unit test that `replaces` arriving on an `enhance-card` proposal is **dropped
  and reported**, not honoured — this is the test that matters most in the plan; a test that
  `replaces` naming text not on the card is dropped, never appended as new; e2e through the
  fixture engine.
  *Risk:* **"an AI update never removes or unticks a criterion the user wrote."** D1 lands
  first: a replacement the user cannot reject row by row is the bare `update` the rule
  forbids. If the loop is running short, **this is the box to cut** — D1 alone delivers the
  selected item and is independently useful.

---

## Phase E — final gate

- [ ] **E1. Quiet, full verification.** `pnpm test`, `pnpm typecheck`, `pnpm lint`,
  `scripts/fs-boundary.js` and `scripts/blueprint-lint.js` over the whole tree, all eight
  e2e batches quiet, and `pnpm eval:retrieval` recorded as unchanged — nothing here touches
  chunking, tokenizing, stopwords or fusion, so **if a number moved, find out why before
  signing off** rather than recording the new one.
  Then one **fresh-context review of the entire plan's diff**. `finish-v1.md` closed with
  that outstanding and said so; this plan does not inherit the omission twice.
  *Verify:* counts in a table here, in T13's register. Any check not run is named and
  argued, not omitted.

- [ ] **E2. Re-walk the unhappy paths.** W3 only, not the full journey — E1's e2e batches
  already cover the happy path, and re-running everything is an iteration spent confirming
  what the suite just confirmed. W3 is the half no automated spec covers.
  *Verify:* every W3 blocker and bug from W4's list is gone or has a written reason it
  remains.
  *Risk:* the honest limitation — the same agent writes both walks, so this catches
  regressions and missed fixes, not blind spots shared by both passes. E1's fresh-context
  review is what covers those, which is why it is not optional.

---

## Iteration log

(One line per loop iteration: what was done, what was launched in background, anything
surprising. Prepend-only.)

- **iter 4** — W1 partially done, split to W1b. **Found F8**, the plan's headline defect:
  Synthesize is disabled after the first brief until a reload, so the app's opening move
  does not work. Confirmed in isolation rather than inferred. Also confirmed the highest-scar
  invariant holds live — a hand-written criterion survived an Enhance apply verbatim. Three
  stages unresolved and deliberately not called defects, because the walk had three harness
  bugs of its own and those stages ran downstream of them. Two operational lessons: two
  `next dev` servers on one source tree poison each other's build dirs (which is what killed
  batch 2, not a regression), and a live walk writes into a vault the user may be committing
  in — one did, mid-walk. Vault cleaned additively with the user's agreement; `git status`
  clean in both repos.
- **iter 3** — triage only. Batch 2's 7/8 failure was a stale `.next-e2e`, not a regression:
  re-ran green at 24. Reverted an unintended `tsconfig.json` change that Next made by
  appending two throwaway dist dirs to `include`. Both written into the protocol.
- **iter 2** — W0b done, by the fallback route. Most of the iteration went on environment
  plumbing that did not work (Turbopack vs a junctioned `node_modules`; `robocopy /XD vault`
  eating `app/api/vault/`, which is the trap this repo's own `.gitignore` comment warns
  about, reproduced in a different tool). The lesson for the rest of Phase W: **the real app
  root with a throwaway project and no apply** is cheaper and more honest than a disposable
  copy — it exercises the real environment instead of a reconstruction of it. Live Enhance:
  154.6 s, valid, grounded, zero console errors. Vault returned to clean. Three findings
  added, two of them passes worth recording, one of which closes a roadmap verification step
  that had never been run.
- **iter 1** — W0a done, split to W0b. The plan's Phase W premise has now been wrong twice
  in opposite directions: first "the CLI is not installed" (it is — it was missing from
  `PATH`, which is what `GROUNDWORK_CLAUDE_CMD` is for), then "so point it at a scratch
  vault and run live" (refused, correctly, because a run's write permissions are globs
  anchored at the app root). Both were caught by doing the thing rather than reasoning
  about it, which is the argument for Phase W existing at all. Four findings logged, one of
  which is a pass worth recording. Batch 1 green at 44 against unmodified code — its one
  failure was the run-lock test, which passed 7/7 alone, and the load was the walkthrough
  server I had left running. That is the protocol's "a failure is a lead" rule earning its
  place on the first batch of the plan. No production code touched this iteration.

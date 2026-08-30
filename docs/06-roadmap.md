# 06 — Build roadmap

Eight phases. Each one ends in something you can open in a browser and use. No phase is "wire up the plumbing" with nothing to show.

---

> **Status (2026-08-25): all eight phases complete**, plus a design rebuild and a
> three-phase repository track that this roadmap predates. 703 unit tests, 240 e2e, lint and
> typecheck clean, both gates clean.
>
> **The live-model half of the verification script below has now been run** (steps 3, 4, 5,
> 7), twice, against a real repository. It found four defects that 667 unit tests and 238 e2e
> could not, every one of them on the seam the fixture engine cannot stand in for: a moved
> vault read the wrong project; ten honest citations were reported as fabrications because
> the excerpt writer fenced with backticks and the verifier cut on `##`; one 6.8 KB README
> exhausted the excerpt budget so the model got prose and no source; and `"medium"` was
> rejected by a schema wanting `med`, discarding a complete and valid plan. Two fresh-context
> reviewers then found nine more, two serious — a citation forgeable by ordinary repo content,
> and a junction walking through both export refusals. The lesson is recorded rather than
> just the fixes: **the surfaces a fixture engine cannot reach are where the defects were,
> all of them.**
>
> One weakness came out of that live run as a measurement rather than a bug, and is now
> fixed and gated — see *Retrieval* below.
>
> **The work this roadmap did not foresee.** Eight phases were planned; three tracks
> happened. Phases 1–7 as written; then a design rebuild (Graphite tokens, component
> primitives, real labels for the enums, drawers for working and modals for deciding) because
> two earlier designs were rejected; then P1–P3, the repository track, which is the feature
> the app is actually for and which the eight phases above never mention:
>
> - **P1 — connect a repository, read-only.** One optional frontmatter field. `lib/repo.ts`
>   as the second exception to the vault-only disk rule, containment checked lexically and
>   again against the resolved real path.
> - **P2 — index it, and measure whether retrieval works.** Incremental by content hash,
>   binary vectors, keyword and semantic ranking fused. `pnpm eval:retrieval` prints the
>   numbers; `tests/index-eval.test.ts` gates the keyword floors.
> - **P3 — plan against the code.** Excerpts retrieved in process into the run directory, a
>   citation schema with three distinct states, and verification by string match against the
>   bytes the model was actually shown.
>
> See [01-features.md](01-features.md) section J and
> [04-ai-layer.md](04-ai-layer.md) for what each of those does.
>
> **Vault prose is never turned into an HTML string.** `lib/inline.ts` tokenises inline
> emphasis and `components/ui/Prose.tsx` renders those tokens as React elements. The text
> displayed here can originate from an AI proposal the user accepted, so a
> markdown-to-HTML pipeline would route model output through `dangerouslySetInnerHTML`.
> Tests assert `<script>` and `<img onerror=>` appear as literal text and create no
> elements.
>
> **An enhancement persists, a card has a page, and Settings says who is signed in.** Closing
> the card drawer used to lose a finished enhancement — nothing recorded which card a run was
> for, and the two "pending proposal" lookups were job-agnostic, so a card's enhancement even
> surfaced on the brief page. Now `run.json` carries `cardId`, `pendingRunFor` is the one
> scoped lookup, `EnhanceCard` is seeded once from the card's runs (and polls a run still in
> progress), and `EnhanceHistory` lists every run with its outcome, showing the proposal rather
> than a diff against the current card. The drawer's body became `CardEditor`, so
> `/p/<slug>/cards/<id>` renders the same editor with the description and backlinks the drawer
> never showed; the drawer links to it and a Ctrl-click on a tile opens it. `/settings` asks
> the CLI (`claude auth status --json`) which account is connected and gives the commands for
> every other state; the CLI's own config file was rejected as a source because on the build
> machine it named a different account than the CLI did. Description editing on the page and
> the dashboard's next-action linking to a card are deferred with their reasons in 01.
>
> **Criteria are the user's, and the AI can only add to them.** A card created on the board
> had no way to write an acceptance criterion in the app, and an accepted Enhance replaced the
> whole card body — deleting any criterion the model did not echo back, clearing every tick,
> dropping prose after the list — while the review showed no before/after. Now the drawer
> adds, renames, removes and reorders criteria as one-line byte-preserving writes through one
> write chain per card (`lib/writeChain.ts`), the apply merges the proposal over the card's own
> checklist (`lib/ai/merge.ts`: kept / kept-omitted / added, ticks preserved, description
> replaced and shown first), and the write carries the baseline the review saw.
> Reviewed by three independent agents before it was built; the one fork — what to do with a
> criterion the model omits — went to "keep it and say so", because with per-card accept the
> alternative holds the whole enhancement hostage to one line.
> **Designed, not built — "Sharpen this criterion":** a quiet action in a row's edit mode;
> job `{ kind: "sharpen-criterion", slug, cardId, index }`, the criterion named to the model
> by text; one `update` card whose `acceptance` carries an optional `replaces: string[]`;
> `mergeCardBody` learns a `replaced` status that takes the new text but keeps position and
> tick. The user named the target in the request, so the model still never gets a delete.
> Per-criterion accept in the review is the other half and is deferred with it.
>
> **Roadmap lanes are data-driven.** They come from the declared phases *and* from any
> phase number a card actually references — a card on phase 3 in a project whose
> `roadmap.md` declares none would otherwise be present on the board and invisible on
> the track.
>
> **Running the e2e suite while other heavy work is in flight gives unreliable results.**
> This box has 4 cores and the suite drives one dev server; a killed run also orphans
> that server on 4849, which the next run may adopt. If the suite fails wholesale rather
> than in one place, check for a stray listener before reading anything into it.
>
> **Index performance is load-bearing.** The rail renders in the root layout, so every
> page rebuilds the vault index. Serial reads plus a second recursive mtime walk plus no
> request coalescing pushed server render time to 8-15s under parallel load. Now:
> concurrent reads, timestamps taken from documents already read, and an in-flight map
> so simultaneous requests share one build. Render is back under 2s.
>
> Phase 4 shipped whole: engine seam, CLI and fixture engines, run storage, the
> concurrency lock, SSE progress, schema validation, the grounding check, per-block diff
> review, apply with a snapshot manifest, revert, and vault auto-commit.
>
> **The AI e2e specs live in one file on purpose.** The subsystem has a single global
> run lock, so two spec files exercising it in parallel is not a test-isolation problem
> to work around — it is an invalid scenario. One serial file matches reality.
>
> **The engine seam earns its keep in testing.** `GROUNDWORK_AI_ENGINE=fixture` selects
> a deterministic engine that builds its proposal from the project's real brief — so
> quotes are genuinely verified — and deliberately includes one card quoting text the
> brief does not contain, which is how the e2e suite proves the ungrounded warning
> actually fires. Exercising this against a live model would be slow, cost tokens, and
> assert nothing about the application.
>
> Two decisions taken during the build that the docs above predate:
>
> - **Writes to `project.md` share one baseline.** The brief editor and the metadata bar
>   both write that file, so `ProjectDocProvider` owns the mtime and serialises every
>   write through one promise chain. Without it, changing the stage would stale the
>   editor's baseline and 409 the user's next keystroke.
> - **Typechecking deliberately excludes Next's generated route types.** Next appends an
>   import of the most recent `distDir`'s types to `next-env.d.ts`, and an imported file
>   bypasses tsconfig `exclude` — so `pnpm typecheck` passed or failed depending on
>   whether `dev` or `test:e2e` ran last. See `types/next-globals.d.ts`; route params are
>   typed by hand as a result.

## Phase 1 — Scaffold, vault layer, dashboard

Next.js 16 + React 19 + Tailwind 4 project. Blueprint tokens in `globals.css`, fonts wired through `next/font/google`. `lib/vault.ts` with read, slug validation, path-traversal rejection, and the in-memory index. `lib/nextAction.ts`. Dashboard table. `groundwork.cmd`.

Write one sample project into `vault/` **by hand**, to spec — it doubles as the render fixture and as proof the format is writable by a human. `git init` the vault with a `.gitignore` covering `.snapshots/` and `.trash/`, and commit that sample as the baseline.

`fixtures/briefs/` is already written and needs nothing this phase — it comes into use at Phase 4 when there is a synthesize run to judge.

Close the phase by wiring the deterministic gates: run `coach-core:setup-gates` to generate `.claude/gates.json` with two per-file lint scripts — `scripts/blueprint-lint.js` (greps `.tsx`/`.css` for shadows, radius above 2px, `#4f46e5`, gradients, `backdrop-filter`) and `scripts/fs-boundary.js` (`fs` imports anywhere outside `lib/vault.ts`) — plus `pnpm lint` as a stopCheck. Gates cannot be wired before this point: setup-gates verifies every command actually runs before writing the file, and until the scaffold exists there is nothing to verify against.

**Done when:** the hand-written project renders on the dashboard with the right stage, health, phase progress, and next action, and adding a second folder by hand makes a second row appear on refresh.

---

## Phase 2 — Workspace shell and brief editor

App shell: left rail vault tree, project chrome with tabs, routing under `app/p/[slug]/`. CodeMirror brief editor with markdown highlighting, debounced autosave, explicit save, visible save state. Saves carry the `mtimeMs` the editor loaded; a stale write returns 409 and surfaces as "changed on disk — reload". Metadata bar for stage / health / archetype. Command palette navigating projects and views.

**Done when:** you can edit a brief, hard-refresh, and see the text preserved — with the frontmatter block byte-identical to before the edit.

---

## Phase 3 — Board

Columns from `project.md`, cards from `cards/*.md`. `@dnd-kit` drag across and within columns, writing `column` and `order` on drop. Card detail pane with editable metadata and a live acceptance-criteria checklist. Create, delete-to-trash, and column management.

**Done when:** dragging a card and reloading keeps it exactly where it was dropped, and `git diff` on the vault shows only that one card's file changed.

---

## Phase 4 — The AI planning stage

The centrepiece. `lib/ai/engine.ts` interface and `claude-cli.ts` implementation: spawn via `cmd /c`, stream-json parsing, `friendly()` progress mapping, SSE, run lock, survive-disconnect. Headless allow rules in `.claude/settings.json`. `prompts/synthesize.md`. Zod proposal schema with verbatim `groundedIn` checking. Diff review UI. Apply with snapshot manifest. Revert. `lib/git.ts` auto-commit.

Run the `fixtures/briefs/` probes here for the first time and tune `synthesize.md` against their expectations before moving on. This is the phase where prompt quality is actually decided.

**Done when:** a deliberately vague five-line brief produces cards you can accept individually; rejecting one of five yields exactly four files; the apply produces one scoped commit; and revert leaves the working tree byte-identical to the pre-apply state.

---

## Phase 5 — Enhance, questions, critique

`prompts/enhance-card.md` and `prompts/critique.md`. Open Questions view with answering. Answered questions injected into every later run's context. Unanswered count badging the project on the dashboard, in the rail, and in the tab bar.

**Done when:** answering a question and re-running synthesis produces output that visibly reflects the answer.

---

## Phase 6 — Roadmap, log, risks

Phase track reading `roadmap.md` with per-phase card counts. Decision log with prepend-only entries. Risk and assumption register, with AI-proposed additions arriving through the normal proposal path.

**Done when:** a decision written today appears above yesterday's in `log.md`, and critique can add a risk that you accept in the diff review.

---

## Phase 7 — Links and search *(shipped)*

Wiki-link parsing in the index pass, slug-before-title resolution, unresolved links styled distinctly. Backlinks panel on projects and cards showing source lines. Vault-wide text search grouped by project.

**Done when:** a link from one project's brief to another project's card navigates correctly and shows up in that card's backlinks.

---

## Phase 8 — Export and design audit *(shipped)*

Export agent-ready spec: preview, then write `CLAUDE.md` plus a task checklist into a chosen real project folder, with an explicit diff before overwriting anything. Then a full pass over every screen against the anti-pattern list in [05-design-system.md](05-design-system.md).

**Done when:** the exported file gives Claude Code enough context to start phase 1 of the planned project, and no screen violates the anti-pattern list.

---

## Retrieval — the numbers, and what the last change cost

Baseline for the next person who touches chunking, tokenizing, stopwords or fusion. **Not
comparable to the numbers the P2 commit recorded**, because the corpus changed underneath
them: it was written from code alone, and now contains two prose files. That was not a
cosmetic addition. A live run against a real repository produced a plan in which *every*
citation landed on `README.md` — a document naming every subsystem matches more distinct
query terms than the lines that answer the question, and the code-only corpus had nothing
long or discursive in it, so the gate could not see a failure already happening in
production.

`lib/index/keyword.ts` now discounts length the way BM25 does. Measured on the corpus with
prose in it, k=5:

| | keyword | semantic | hybrid |
|---|---|---|---|
| **Exact-term (12)** before | 100% / MRR 0.625 | 100% / 0.861 | 100% / 0.750 |
| **Exact-term (12)** after | 100% / **0.958** | 100% / 0.861 | 100% / **0.875** |
| **Paraphrase (5)** before | 40% / 0.400 | 100% / 0.557 | 80% / 0.467 |
| **Paraphrase (5)** after | 40% / 0.400 | 100% / 0.557 | 80% / **0.367** |

**The cost is stated because it is real.** Eight of twelve exact-term queries came back to
rank one, and hybrid MRR on paraphrases fell by 0.100. That is the correction doing something
useless on queries where the keyword half matched one term out of nine: normalising near-noise
only reshuffles what it hands to fusion. Recall — whether the answer was in the top five at
all — did not move on either set. The trade was taken because the failure it fixes was
observed on a real repository and the one it costs was not, but a future change to the
semantic half should know the paraphrase number is depressed and why.

**Still open, honestly.** Retrieval is corrected for length, not for genre. A README is still
a legitimate hit and often the right one; nothing here teaches the ranker that a *planning*
question wants source. `b` was measured flat across 0.25–0.75 rather than fitted, so the
gain is the correction and not the constant — but the next real improvement is a bigger,
more varied corpus, not a better number on this one.

---

## Verification

### End-to-end script (run after Phase 5, again after Phase 8)

1. Create project "Test Rebuild", archetype `client`.
2. Paste a deliberately vague five-line brief.
3. Run Synthesize. Confirm progress lines stream with real step names, not a spinner.
4. In the diff, reject one card and accept the rest. Confirm exactly the accepted cards exist in `vault/test-rebuild/cards/`.
5. Confirm `questions.md` has open questions, and that nothing the brief did not say was asserted as fact in a card.
6. Drag a card across two columns, reload. Position persists.
7. Enhance that card. The output references specifics from the brief, not generic boilerplate.
8. Revert last AI change. The working tree returns to the pre-apply state, and `git log --oneline -2` shows the `ai(...)` commit followed by its `revert(ai:...)` — history records both rather than rewinding.
9. Rename `vault/.git` temporarily and run another apply. It succeeds with a non-blocking notice about the missing repo — a broken audit trail never blocks a write.
10. Kill the browser tab mid-run. The run completes and the proposal is waiting on reload.

### Automated tests

Deliberately small — five tests that each guard a way real data could be destroyed:

1. A body edit preserves the frontmatter bytes; a frontmatter edit preserves the body bytes.
2. `lib/vault.ts` rejects `../`, absolute paths, and out-of-regex slugs.
3. The zod proposal schema rejects malformed AI output instead of writing partial data.
4. `nextAction.ts` returns the correct result for each of its four branches.
5. A write with a stale `mtimeMs` returns 409 and leaves the file untouched.

### Standing guard

Every AI apply commits the vault automatically, so this guard reads itself: run `git log --oneline` and look at the diff sizes. Each apply should be worth about one reviewable commit. If they are consistently larger than that, the proposals are too coarse and the prompts need tightening — a product bug, not a preference.

The same log is the fastest read on whether the AI layer is earning its place. If the `ai(...)` commits mostly get reverted, the prompts are wrong. If they stop appearing, the feature isn't worth its latency.

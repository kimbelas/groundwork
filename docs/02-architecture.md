# 02 — Architecture

## Stack

A local-only Next.js app that reads and writes markdown on disk and drives the Claude Code CLI over SSE. The shape was borrowed from an earlier local tool of the same kind, which is why several choices below are stated as familiarity rather than analysis. Groundwork is standalone: it shares no code, config or plugin with anything else on the machine.

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16, App Router | Route handlers give us a server with zero extra process |
| UI | React 19 + TypeScript | Same |
| Styling | Tailwind 4 with CSS custom properties | Same; tokens live in `globals.css` under `@theme inline` |
| Package manager | pnpm | Already installed (10.29.3) |
| Frontmatter | `gray-matter` | Round-trips YAML frontmatter without mangling the body |
| Markdown render | `marked` | Already the choice in claude-coach |
| Editor | `@uiw/react-codemirror` + `@codemirror/lang-markdown` | Markdown-source-of-truth editing, the Obsidian feel |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Keyboard-accessible, no legacy HTML5 DnD quirks |
| Validation | `zod` | Guards every AI response before it can touch disk |

No database. No ORM. No state management library — server components read the vault, client components hold local edit state and POST back.

## Running locally

Local only, bound to loopback:

```
next dev -H 127.0.0.1 -p 4848
```

Port 4848 because claude-coach owns 4747. `groundwork.cmd` at the repo root mirrors `claude-coach/coach.cmd`:

```bat
@echo off
cd /d %~dp0
start "" http://127.0.0.1:4848
pnpm dev
```

## Folder layout

```
groundwork/
  app/
    page.tsx                    Dashboard
    layout.tsx                  Shell: left rail + working pane
    globals.css                 Blueprint tokens
    p/[slug]/
      layout.tsx                Project chrome: title, tabs, AI actions
      brief/page.tsx
      board/page.tsx
      roadmap/page.tsx
      log/page.tsx
      questions/page.tsx
    api/
      vault/route.ts            GET list projects, POST create project
      vault/[slug]/route.ts     GET project bundle, PATCH file write
      cards/route.ts            POST create, PATCH move/update, DELETE
      ai/run/route.ts           GET SSE: retrieve repo context, spawn CLI, stream progress
      ai/proposal/route.ts      GET proposal + grounding report, POST accept/reject
      ai/revert/route.ts        POST restore the newest snapshot
      index/[slug]/route.ts     POST build or preview the repo index, GET search it
      log|questions|risks/      POST a decision, an answer, a register entry
      search/route.ts           GET vault-wide text search
      export/route.ts           POST preview or write the agent-ready spec
  components/
    rail/            Rail, RailShell
    board/           Board, Column, CardTile, CardDetail, ColumnManager
    editor/          BriefEditor, SaveState, useAutosave, markdownHighlight
    project/         MetaBar, NewProject, ProjectTabs, ProjectDoc,
                     RepoConnect, RepoPanel, IndexPanel, IndexControls,
                     ExportPanel
    ai/              AiPanel, ProposalReview, EnhanceCard, RevertButton, useRun
    links/           Backlinks
    log/ questions/ risks/ roadmap/ theme/
    ui/              Button, IconButton, Input, Chip, Notice, Drawer,
                     ConfirmDialog, Placeholder, Prose, cx
  lib/
    vault.ts         the only module that touches disk (see the exceptions below)
    runs.ts          owns .groundwork/runs/ - proposals, excerpts, the run lock
    repo.ts          reads a connected repository; read-only, never inside vault/
    schema.ts        zod schemas for frontmatter
    links.ts         wiki-link parsing and the link graph
    nextAction.ts    the dashboard heuristic
    dismiss.ts       one Escape listener and a stack of layers
    labels.ts        codes in files, words on screen
    ordering.ts      sparse card order arithmetic, server-side only
    git.ts           vault auto-commit (shells out to git, never imports fs)
    export.ts        composes and writes the agent-ready spec (fourth fs exception)
    ai/
      engine.ts      AiEngine interface and engine selection
      claude-cli.ts  Claude Code CLI implementation; prepareRun is its seam
      fixture.ts     deterministic engine for the e2e suite
      context.ts     retrieves repo excerpts into the run directory
      scope.ts       refuses to name any path outside the app root to a run
      grounding.ts   verifies quotes against the brief and against the excerpts
      apply.ts       apply-with-snapshot, revert
      types.ts       job, event, proposal and run-record schemas
    index/
      build.ts       walk, hash, chunk, embed - incremental by content hash
      chunk.ts       line-anchored chunking; every chunk carries its line range
      embeddings.ts  the local model, optional by design
      keyword.ts similarity.ts fusion.ts   the three rankers
      retrieve.ts    hybrid search and the citation format
      store.ts       the only module under lib/index/ that touches disk
      eval.ts        retrieval quality as a number
  prompts/
    synthesize.md
    enhance-card.md
    critique.md
  fixtures/
    README.md        how to use the probes
    briefs/          probe briefs + expectations, for judging prompt quality
  vault/             the data (its own git repo)
  .groundwork/
    runs/<runId>/    proposal.json, stdout.log, context/repo-excerpts.md
    index/<slug>/    manifest.json, chunks.json, vectors.bin - derived, git-ignored
    run.lock
  docs/
  groundwork.cmd
```

## Module boundaries

Three rules keep this from turning into a pile of `fs` calls. The first has three
exceptions, each argued rather than assumed and each listed below it;
`scripts/fs-boundary.js` is what makes them exceptions rather than precedents.

**1. `lib/vault.ts` is the only module that touches disk.**
Route handlers call it. Server components call it. Nothing else does — no `fs` import in `components/`, none in `app/**/page.tsx`, none in `app/api/**/route.ts`. Its one neighbour is `lib/git.ts`, which shells out to the `git` binary and never imports `fs` itself, so the rule holds exactly as written and `scripts/fs-boundary.js` needs no exception for it. All of the safety lives in one file:

- slug validation: `/^[a-z0-9][a-z0-9-]{0,63}$/`
- card filename validation: `/^\d{4}-[a-z0-9-]+\.md$/`
- every resolved path re-checked to be inside the vault root before read or write
- an in-memory index, invalidated per project on writes and by a recursive `fs.watch` for external edits — NTFS directory mtimes don't propagate from subdirectories, so watching beats polling — keeping the dashboard from re-parsing every file on every request

Model the defensive style on `claude-coach/lib/coach.ts`, which already does `safeRead`, filename regex guards, and list-and-parse.

**2. Everything AI goes through `lib/ai/engine.ts`.**

```ts
export type AiJob =
  | { kind: 'synthesize'; slug: string }
  | { kind: 'enhance-card'; slug: string; cardId: number }
  | { kind: 'critique'; slug: string }

export type AiEvent =
  | { type: 'step'; label: string }
  | { type: 'done'; runId: string }
  | { type: 'error'; message: string }

export interface AiEngine {
  run(job: AiJob, runId: string, onEvent: (e: AiEvent) => void): Promise<void>
}
```

The run id is passed *in* rather than returned, and nothing comes back: the route creates
the run record and retrieves repository context before any process exists, and the proposal
is written to the run directory. Both so a browser that disconnects mid-run loses nothing.

`claude-cli.ts` is the only implementation in v1; `fixture.ts` is the deterministic engine
the e2e suite selects with `GROUNDWORK_AI_ENGINE=fixture`. An `anthropic-api.ts` can be
added later without any UI change — that is the entire reason the interface exists.

**3. The AI never writes into `vault/`.**
It writes `.groundwork/runs/<runId>/proposal.json`. `lib/ai/apply.ts` validates it, diffs it against current state, and writes only what the user accepted — after snapshotting. See [04-ai-layer.md](04-ai-layer.md).

### The three exceptions to rule 1

Each owns a tree that is not `vault/`, and each is a weaker claim than the last.

**`lib/runs.ts`** owns `.groundwork/runs/`. Keeping run artefacts out of the vault module is
what lets the spawned CLI be granted write access to exactly one directory. It carries its
own id validation and containment check, mirroring the vault's.

**`lib/repo.ts`** owns a *third* tree: a connected repository. It never resolves inside
`vault/` and never writes at all. Routing repo reads through `lib/vault.ts` would keep the
letter of rule 1 and lose its reasoning — that module's contract is "every path is anchored
at the vault root", and a function there that deliberately resolved elsewhere would make
containment depend on which function you called. Containment is checked twice: lexically
with `path.relative` (a prefix test reads `/repo-backup` as inside `/repo`, and Windows
compares case-insensitively), then again against the resolved *real* path at read time,
which is the check the lexical one cannot make — `src/leak.md` is an ordinary
repo-relative path and only the filesystem knows it points at `~/.ssh`. The read-only
claim is enforced by `tests/repo.test.ts`, which fails if a writing `fs` call appears in
the module.

**`lib/index/store.ts`** owns `.groundwork/index/`. The same argument as `lib/runs.ts`, and
it is the only file under `lib/index/` that touches disk — which is what lets the chunking,
ranking and fusion rules be tested without a filesystem.

**`lib/export.ts`** is the fourth, and the only one that writes *outside this application*.
The three above own a directory; `lib/repo.ts` reaches a third tree but never writes at all,
which is the whole of its argument and export cannot borrow it. So it carries its own
contract: two filenames, both constants in the module and neither taken from a caller; an
existing directory only, never created, because a typo should fail rather than scatter files;
the vault and this app's own root refused in both directions — the second being the dangerous
near-miss, since it would overwrite the instructions this app runs under; nothing deleted or
renamed but its own temp file; and a preview of what would be overwritten before anything is.

That last one is a precondition rather than a courtesy: `writeExport` takes the list of files
the caller has shown the user as being replaced, and refuses anything else it would replace.
The route re-reads the folder at write time, so a file created between the preview and the
click stops the write instead of disappearing under it — the same reasoning as
`expectedMtimeMs` on a vault write.

`tests/export.test.ts` scans the source and fails if any of that stops being true.

### A connected repository, and why a run never learns where it is

A repo is a property of a project: one optional `repo` field in `project.md` frontmatter,
hand-editable in Obsidian like everything else. No registry, no lifecycle.

A spawned run's permissions are a **denylist** in `.claude/run-settings.json` whose globs
are relative to the app root, and `--allowedTools` grants `Write` broadly because the CLI
does not honour a path-scoped *allow* rule. A connected repo sits outside that root by
definition, so no rule in that file can name it — and a path outside the root is not merely
unlisted, it is unprotected.

So the boundary is built at the other end. The app reads the repo itself, in process,
through `lib/repo.ts`; `lib/ai/context.ts` retrieves the relevant chunks through the index
and writes them to `.groundwork/runs/<runId>/context/repo-excerpts.md`; the run reads that
file and is told the repository is unreachable. `assertInstructionScoped` in
`lib/ai/scope.ts` fails any spawn whose instruction names a path outside the app root,
because the breach is a single plausible edit — adding "the repo is at <path>" to a prompt.

That is not a workaround for the sandbox. It is what retrieval requires anyway: a run left
to grep a repo directly would bypass the index, make cost unpredictable, and put bytes into
the model's context that the grounding check never saw. Verifying a quote means comparing it
against bytes this process read — which is also why the excerpt file redacts the repo path
out of chunk *text*, since a repo can contain its own absolute path in a config or a log.

## Data flow

**Read path.** Server component calls `vault.getProject(slug)` → index cache hit or a parse of the project folder → typed object → rendered. No client fetch for initial paint.

**Write path (human).** Client component POSTs to a route handler carrying the `mtimeMs` it loaded → handler validates input → `vault.write*()` checks that precondition and refuses with 409 if the file changed underneath (an AI apply, a second tab, Obsidian) → file written, that project's index entry invalidated → `router.refresh()`. The 409 surfaces as "changed on disk — reload", never a silent last-writer-wins clobber. Without this, the brief editor's 1-second autosave would overwrite an AI apply that landed mid-edit — both write `project.md`.

**Write path (AI).** Client opens SSE to `/api/ai/run` → handler acquires the lock and spawns the CLI → progress events stream back → CLI writes `proposal.json` and exits → handler emits `done` with the `runId` → client navigates to the diff review → user accepts blocks → POST to `/api/ai/proposal` → snapshot, then `vault.write*()` for accepted blocks only.

## Concurrency and resilience

- **One AI run at a time**, enforced by `.groundwork/run.lock`. A second attempt returns 409 with a clear message. Same approach as `acquireLock` / `releaseLock` in claude-coach.
- **The child process survives SSE disconnect.** Synthesis takes minutes; closing a tab must not kill it. claude-coach already does this by holding the child in a module-level variable rather than tying its lifetime to the response stream. Stopping is explicit: `GET /api/ai/run?action=stop`.
- **Proposals persist.** If the tab is gone when the run finishes, the proposal is still on disk and the project shows a "proposal ready" banner on next load.

## Security posture

It is a single-user app on loopback, so there is no auth — but it writes to the filesystem, so the boundary is still real:

- Bind to `127.0.0.1` explicitly, never `0.0.0.0`.
- Every path is validated in `lib/vault.ts` and confirmed to resolve inside the vault root.
- The export target folder (the one feature that writes outside the vault) requires an explicit absolute path, shows a preview diff, and refuses to overwrite without confirmation.
- The CLI is spawned with an argument array, never a shell string, so no interpolation of user text into a command line.

## Testing

Small and targeted — this is a single-user local tool, not a service:

1. A body edit preserves the frontmatter block byte-for-byte; a frontmatter edit preserves the body byte-for-byte (the write rule in [03-data-model.md](03-data-model.md)).
2. `lib/vault.ts` rejects `../`, absolute paths, and slugs outside the regex.
3. The zod proposal schema rejects a malformed AI response instead of writing partial data.
4. `nextAction.ts` returns the right answer for each of its four branches.
5. A write carrying a stale `mtimeMs` returns 409 and leaves the file untouched.

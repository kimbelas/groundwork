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
      ai/run/route.ts           GET SSE: spawn CLI, stream progress, emit runId
      ai/proposal/route.ts      GET proposal, POST accept/reject
      search/route.ts           GET vault-wide text search
      export/route.ts           POST write agent-ready spec to a target folder
  components/
    rail/            VaultTree, RailHeader
    board/           Board, Column, Card, CardDetail
    ai/              RunProgress, DiffReview, ProposalBlock
    ui/              Rule, Chip, Pane, Tabs, CommandPalette, Backlinks
  lib/
    vault.ts         the only module that touches disk
    schema.ts        zod schemas for frontmatter and proposals
    links.ts         wiki-link parsing and the link graph
    nextAction.ts    the dashboard heuristic
    git.ts           vault auto-commit (shells out to git, never imports fs)
    ai/
      engine.ts      AiEngine interface, job types, event types
      claude-cli.ts  Claude Code CLI implementation
      proposal.ts    diff, apply-with-snapshot, revert
  prompts/
    synthesize.md
    enhance-card.md
    critique.md
  fixtures/
    README.md        how to use the probes
    briefs/          probe briefs + expectations, for judging prompt quality
  vault/             the data (its own git repo)
  .groundwork/
    runs/<runId>/    proposal.json, raw stdout log
    run.lock
  docs/
  groundwork.cmd
```

## Module boundaries

Three rules keep this from turning into a pile of `fs` calls.

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
  run(job: AiJob, onEvent: (e: AiEvent) => void): Promise<{ runId: string }>
}
```

`claude-cli.ts` is the only implementation in v1. An `anthropic-api.ts` can be added later without any UI change — that is the entire reason the interface exists.

**3. The AI never writes into `vault/`.**
It writes `.groundwork/runs/<runId>/proposal.json`. `lib/ai/proposal.ts` validates it, diffs it against current state, and writes only what the user accepted — after snapshotting. See [04-ai-layer.md](04-ai-layer.md).

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

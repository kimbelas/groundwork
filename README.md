# Groundwork

A local-first planning workspace for projects you're starting up.

Obsidian's structure — a vault of markdown files, a left rail, wiki-links, a command
palette — with a **planning stage** built into the middle of it. You dump a messy
high-level overview into a project. AI turns it into a real plan: phases, task cards
with acceptance criteria, risks, assumptions, and the questions it couldn't answer.
You review that as a diff and accept the parts you want. What you accept becomes a
kanban board you work.

Everything lives as plain markdown in `vault/`. No database, no account, no cloud.
Open the same folder in Obsidian if you like. Point Claude Code at it. It's yours.

## Why it isn't just another AI planner

- **AI proposes, never overwrites.** Every run produces a proposal you accept or
  reject block-by-block. A snapshot is taken before anything is written.
- **AI asks instead of inventing.** Gaps become an Open Questions queue. You answer
  them; the answers feed the next run. Nothing gets fabricated to fill a template.
- **Enhancement is context-aware.** Expanding a one-line card sends the whole brief,
  so what comes back fits the plan instead of being generic filler.

## Running it

```
pnpm install
pnpm dev          # http://127.0.0.1:4848
```

Or double-click `groundwork.cmd`, which starts the dev server and opens the browser.

Requires the Claude Code CLI on this machine (`claude.cmd`) — Groundwork spawns it
for AI work, so there's no API key and no per-token cost.

## Docs

| File | What's in it |
|---|---|
| [docs/00-overview.md](docs/00-overview.md) | Product thesis, the core loop, non-goals, glossary |
| [docs/01-features.md](docs/01-features.md) | Full feature spec with acceptance criteria |
| [docs/02-architecture.md](docs/02-architecture.md) | Stack, folder layout, routes, module boundaries |
| [docs/03-data-model.md](docs/03-data-model.md) | Vault format, frontmatter schemas, index, link graph |
| [docs/04-ai-layer.md](docs/04-ai-layer.md) | CLI invocation, prompts, proposal schema, snapshots |
| [docs/05-design-system.md](docs/05-design-system.md) | Blueprint tokens, type, components, anti-patterns |
| [docs/06-roadmap.md](docs/06-roadmap.md) | Build phases 1–8 with "done when" per phase |
| [fixtures/README.md](fixtures/README.md) | Probe briefs for judging prompt quality after a prompt edit |

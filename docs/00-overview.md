# 00 — Overview

## The problem

Projects get started faster than they get thought through. The valuable thinking at
the beginning — what this actually is, what order it has to happen in, what I'm
guessing at — currently lands in a one-off `BUILDPLAN.md` or `<project>-plan.md` with
no shared shape. Six weeks later there's no record of why a decision went the way it
did, and there's no single place that answers "what are all my projects and what does
each one need next?"

Generic AI planners fail this in a specific way: you paste a vague brief, they emit a
confident, complete-looking plan built mostly from template filler, and they overwrite
your file to do it. The output looks like planning and isn't. You can't tell which
parts came from what you said and which parts the model made up.

## The thesis

**Obsidian's structure, with a planning stage in the middle of it.**

Keep everything that makes a markdown vault good: files you own, plain text, a left
rail, wiki-links, a command palette, works offline, opens in another editor. Then add
the one thing a vault can't do on its own — turn a messy overview into a structured
plan — and make that addition trustworthy by construction:

1. **AI proposes, never overwrites.** Every run produces a proposal. You see it as a
   diff and accept or reject block by block. A snapshot is taken before anything
   lands, and one keystroke reverts.
2. **AI asks instead of inventing.** What the model doesn't know becomes an entry in
   the Open Questions queue, not a confident sentence. You answer; the answer feeds
   the next run. The plan gets sharper because you thought, not because the model
   guessed better.
3. **Enhancement is context-aware.** Expanding a single card sends the whole brief and
   the sibling card titles, so the result fits the plan around it.

## The core loop

| # | Step | What happens |
|---|---|---|
| 1 | **Capture** | Dump an unstructured overview into the project Brief. No format required, no fields to fill. |
| 2 | **Synthesize** | One action turns the brief into phases, task cards with acceptance criteria, risks, assumptions, and open questions. |
| 3 | **Review** | The proposal renders as a diff. Accept or reject each block. |
| 4 | **Work** | Accepted cards land on the board. Drag them through columns. |
| 5 | **Enhance** | Any card can be expanded by AI that has read the whole brief first. |
| 6 | **Answer** | Open questions accumulate. Answering them changes what the next synthesis produces. |

Steps 2–6 are re-runnable at any time. The brief is never "finished."

## What Groundwork is not

Explicit non-goals for v1, so scope doesn't drift:

- Not multi-user. No auth, no sharing, no permissions.
- Not cloud-synced. If you want sync, git the vault folder.
- No notifications, reminders, or email.
- No time tracking, no burndown, no velocity.
- No Gantt charts and no task dependency graphs. Phases are the only ordering.
- Not mobile. Desktop browser at `127.0.0.1:4848`.
- Not a replacement for the issue tracker on a real, running project. Groundwork is
  for the stage *before* that — and for the export that hands off to it.

## Glossary

| Term | Meaning |
|---|---|
| **Vault** | The `vault/` folder. Every project lives inside it as a subfolder. |
| **Project** | One folder in the vault. Has a brief, cards, a roadmap, a log, risks, questions. |
| **Brief** | The body of `project.md`. Free-form markdown, the source of truth the AI reads. |
| **Card** | One task. A file in `<project>/cards/`. Carries column, phase, priority, size, confidence, acceptance criteria. |
| **Column** | A board lane. Declared once in `project.md` frontmatter. |
| **Phase** | A stage of the plan (1, 2, 3…). Independent of column — a card has both. |
| **Proposal** | The JSON an AI run produces. Never applied until accepted. |
| **Snapshot** | A timestamped copy of files taken immediately before an apply. |
| **Archetype** | The kind of project (saas-mvp, internal-tool, client, research-spike). Steers synthesis. |
| **Next action** | The one thing this project needs next. Computed by heuristic, shown on the dashboard. |

## Related

- Feature detail → [01-features.md](01-features.md)
- How it's built → [02-architecture.md](02-architecture.md)
- Why the UI looks like it does → [05-design-system.md](05-design-system.md)

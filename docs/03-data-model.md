# 03 — Data model

Everything is markdown with YAML frontmatter. The vault is the database. If the app disappeared tomorrow, the folder would still be useful in Obsidian, in a text editor, or to Claude Code.

## Vault layout

```
vault/                                  its own git repo
  .gitignore                            ignores .snapshots/ and .trash/
  portal-rebuild/
    project.md                          frontmatter = metadata, body = the Brief
    cards/
      0001-auth-spike.md
      0007-billing-api.md
    roadmap.md                          frontmatter: phases[]
    log.md                              append-only dated decisions
    risks.md                            risks + assumptions
    questions.md                        open questions queue
    .snapshots/
      2026-08-18T14-03-11Z/             copies of files an apply was about to touch
    .trash/
      0004-dropped-idea.md
  billing-portal/
    ...
```

Dotfolders inside a project are ignored by the indexer, so snapshots and trash never show up as content. They are git-ignored as well: history already holds every previous state, so committing snapshots would store the same bytes twice.

## One write rule

`gray-matter` — like every YAML round-tripper — re-serializes frontmatter on stringify: quoting shifts, comments vanish. So `lib/vault.ts` never parses and rewrites a whole file to change one half of it. A **body** edit splices the new body under the original frontmatter text, kept verbatim. A **frontmatter** edit re-serializes the frontmatter and leaves the body bytes alone. This is what makes "the half you didn't touch is byte-identical" a testable promise instead of a hope.

A frontmatter edit **refuses to run at all if the existing frontmatter did not parse**. `readData` swallows a YAML syntax error and returns `{}`, which is right for reading — one bad file stays one bad file rather than killing a page — and destructive for writing, because the preservation pass then carries nothing and zod fills in defaults. An unclosed `tags: [portal, q3` plus one stage change erased the tags, erased a `notes:` line, and invented a health, an archetype and a column list. Fixing the YAML is a job for a person; the app cannot know what the missing bytes meant.

A frontmatter edit also **carries across keys the schema does not know about**. A zod object strips unknown keys, so writing the parsed result straight back would delete a `tags:` line someone added in Obsidian, or a field a plugin maintains. The schema is the allowlist for what this app manages; everything else in the block belongs to the user and is preserved. Unknown keys are appended after the managed ones rather than interleaved, which is stable after the first write.

## `project.md`

```yaml
---
name: Portal Rebuild
slug: portal-rebuild
stage: shaping              # idea | shaping | building | paused | shipped | archived
health: green               # green | amber | red
archetype: client           # saas-mvp | internal-tool | client | research-spike
columns: [Backlog, To do, In progress, In review, Done]
repo: C:\work\portal            # optional; absolute path to the connected repository
created: 2026-08-18
updated: 2026-08-18
---

The client wants their portal rebuilt. Current one is a 2019 Angular app nobody
maintains. They care most about the billing screens...
```

### `repo` — the connected repository

A repo is a **property of a project, not an entity of its own**. One optional frontmatter field, hand-editable like everything else. There is no repo registry, no lifecycle, no join table — which is what makes connecting one a change to a single line rather than a subsystem.

It is stored **absolute**, because the vault and the repo are unrelated trees on disk with no meaningful common base. It is stored **resolved**: the app canonicalises the path and follows symlinks before writing it, so a later containment check compares like with like. A symlink can be repointed after the fact; a real path cannot.

Rules, all enforced in `lib/repo.ts`:

- The path must be absolute, must exist, and must be a directory.
- It may not be inside `vault/`, and `vault/` may not be inside it. Either nesting would let repo-grounded planning quote the vault's own prose as though it were source code.
- Access is **read-only**. Nothing in the app writes to a connected repo, and a test fails if any writing `fs` call appears in that module.
- A path that has stopped being valid — renamed, deleted, unplugged — is **kept and reported**, never silently dropped. It records a decision the user made, and the fix is theirs.

Removing the connection is a patch of `repo: null`, which deletes the key. Omitting it, or passing `undefined`, means "leave it alone" — a patch value of `undefined` never clears a field, because zod's `.default()` consumes undefined and would silently reset it.

Reading is deliberately tolerant. A bare `repo:` line — the obvious hand-edit for "disconnect this" — parses as `null`, and a strict `z.string().min(1)` made `getProject` throw and took the whole brief page down. Anything that is not a usable path now reads as absent, and is not written back.

The body is the Brief. It is free-form and the app never restructures it — synthesis reads it and produces cards elsewhere. That separation is what makes the brief safe to write badly in.

`stage` and `health` are human judgments, never set by AI. `updated` is stamped only when `project.md` itself is written — never as a side effect of a card write, so dragging a card stays a one-file diff. The dashboard's "last touched" is derived from file mtimes at index time instead.

`nextAction` is deliberately **not** stored. It is derived at read time by `lib/nextAction.ts`, so it can never go stale.

## Cards — `cards/NNNN-slug.md`

```yaml
---
id: 7
title: Billing API
column: Shaping
phase: 2
priority: P2                # P1 | P2 | P3
size: M                     # S | M | L
confidence: 0.5             # 0-1, AI-suggested, human-editable
blocked: false
order: 300
created: 2026-08-18
updated: 2026-08-18
---

Replace the direct Stripe calls scattered through the current portal with a single
billing service the front end talks to.

## Acceptance criteria

- [ ] One endpoint returns a customer's full billing state in a single call
- [ ] Webhook handling is idempotent
- [ ] No Stripe key reaches the browser
```

Filename is `id` zero-padded to four digits plus a slug of the title. Renaming a card's title does not rename the file — the `id` is the identity.

**Columns are declared once**, in `project.md`. Membership lives in each card's `column`. There is no separate board file to fall out of sync.

`order` uses sparse integers (100, 200, 300…). Inserting between two cards takes the midpoint. When a gap closes to zero, renumber that column from 100 in one pass.

`phase` and `column` are independent axes: phase is *when in the plan*, column is *where in the workflow right now*.

### Sizes and confidence, not hours

`size` is S/M/L. `confidence` is 0–1 and means "how sure are we this is well-understood," not "how likely is it to succeed." A card at 0.3 confidence is a signal to run critique or answer a question, not to pad an estimate.

Hour estimates are banned by convention. On a project that has not started, they are fiction, and having the field invites the fiction.

## `roadmap.md`

```yaml
---
phases:
  - n: 1
    name: Intake
    goal: Understand the existing system well enough to scope the rebuild
  - n: 2
    name: Shaping
    goal: Lock the data model and the billing contract
  - n: 3
    name: Build
    goal: Ship the portal behind a flag
---

Optional prose about sequencing.
```

Cards join a phase by number. A card with no `phase` renders in an "Unphased" lane.

## `log.md`

Append-only, newest first. No frontmatter — the app parses `##` headings.

```markdown
## 2026-08-18 — Billing service owns Stripe, not the front end

**Considered:** calling Stripe from the client with a restricted key; a thin proxy;
a full billing service.

**Because:** the restricted key still leaks customer IDs, and the proxy would grow
into the service within a month anyway.
```

The app only ever prepends. Existing entries are never edited or reordered programmatically — a decision log you can rewrite is not a decision log.

## `risks.md`

```yaml
---
risks:
  - id: r1
    text: The 2019 Angular app has no tests, so behaviour parity is guesswork
    likelihood: high        # low | med | high
    impact: high            # low | med | high
    mitigation: Record the current billing screens as a spec before touching them
assumptions:
  - id: a1
    text: The client will accept a phased cutover rather than a big-bang launch
    validated: false
---
```

Unvalidated assumptions render visually distinct from validated ones. AI runs can propose additions to both lists; they arrive through the normal proposal path and are accepted like anything else.

## `questions.md`

```yaml
---
questions:
  - id: q1
    text: Is the existing Stripe account staying, or is this a fresh one?
    status: open              # open | answered
    answer: null
    fromRun: run_20260818_1403
    created: 2026-08-18
  - id: q2
    text: Does the portal need to keep supporting IE11 for their ops team?
    status: answered
    answer: No. They dropped IE11 internally in January.
    fromRun: run_20260818_1403
    created: 2026-08-18
---
```

Answered questions are prepended to the context of every later AI run. This is the mechanism by which the plan gets better: not by re-prompting, but by the model having more true facts.

The count of `status: open` badges the project on the dashboard, in the rail, and in the tab bar.

## The index

Reading and parsing every file on every request is fine for five projects and not for fifty. `lib/vault.ts` keeps an in-memory index:

```ts
interface VaultIndex {
  builtAt: number
  projects: Map<string, ProjectSummary>   // meta + card summaries, no bodies
  links: LinkGraph
}
```

Invalidation is per project. A write through `vault.ts` re-indexes only the project it touched. External edits — Obsidian, a text editor — are caught by a recursive `fs.watch` on `vault/`, whose events also invalidate just the affected project. Polling the vault root's mtime would not work: on NTFS a directory's mtime does not change when files in its subdirectories do, so an edit to a card file would never be noticed. Bodies are not cached — they are read on demand for the one project being viewed.

No index file is persisted to disk in v1. A persisted cache is a second source of truth and a class of staleness bugs, in exchange for saving a few milliseconds on cold start.

## Link graph

Wiki-links are parsed out of every body during the index pass.

| Form | Resolves to |
|---|---|
| `[[portal-rebuild]]` | that project |
| `[[portal-rebuild/billing-api]]` | that card in that project |
| `[[Billing API]]` | a card whose title matches, searching the current project first, then the vault |

Resolution order is **slug before title**, so an exact slug always wins. Ambiguous title matches across projects resolve to none and render as unresolved.

Unresolved links render in a distinct style rather than as an error. An unresolved link is a note to yourself about something that does not exist yet — a feature, not a mistake.

```ts
interface LinkGraph {
  forward: Map<NodeId, NodeId[]>
  back: Map<NodeId, { from: NodeId; line: string }[]>
}
// NodeId is "slug" for a project or "slug/card-<id>" for a card
```

The backlinks panel reads `back` and shows the source line as context, so you can see *why* something links here without opening it.

## Snapshots

Before any AI apply:

```
vault/<slug>/.snapshots/<ISO8601>/
  manifest.json
  project.md
  cards/0007-billing-api.md
  questions.md
```

Only the files the apply is about to touch are copied. `manifest.json` records the runId, the files copied, and the files the apply **created** — created files have no snapshot counterpart, so without the manifest revert could not tell them apart from files that always existed. "Revert last AI change" restores the newest snapshot directory: copied files are restored, created files are moved to `.trash/`. Snapshots are never pruned automatically in v1 — they are small, and silently deleting a user's undo history is worse than a folder that grows.

## Naming and IDs

- **Project slug**: `/^[a-z0-9][a-z0-9-]{0,63}$/`, derived from the name, editable at creation, immutable after. Windows reserved device names (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) are rejected for both project slugs and card filename slugs — Windows treats them as devices regardless of extension.
- **Card id**: monotonically increasing per project, starting at 1. Assigned by `lib/vault.ts` at write time — never by the AI; `create` blocks in a proposal arrive without ids. Never reused, even after delete — a deleted card in `.trash/` still holds its id so that links and snapshots stay meaningful.
- **Run id**: `run_<YYYYMMDD>_<HHmm>` plus a counter on collision.

# 01 — Features

Every v1 feature with what "working" means. Anything not listed here is out of scope until v1 ships.

---

## A. Vault & navigation

### A1. Left rail vault tree
Collapsible tree of every project in `vault/`, each expanding to its views (Brief, Board, Roadmap, Log, Questions). Current location highlighted. Sorted by `updated` descending by default, with an alphabetical toggle.

*Done when:* adding a folder to `vault/` by hand makes it appear in the rail on refresh, with no other action required.

### A2. Command palette (Ctrl+K)
Fuzzy search over: every project, every card title, every view, and every command ("New project", "Synthesize", "Enhance card", "Revert last AI change", "Toggle sort"). Enter navigates or runs. Escape closes.

*Done when:* you can reach any card in any project in three keystrokes plus Enter, without touching the mouse.

### A3. Vault-wide search
Plain text search across all briefs, cards, logs, and risks. Results grouped by project, showing the matching line with the term highlighted.

*Done when:* searching a word that exists only inside one card body returns that card and nothing else.

### A4. New project
Name, slug (auto-derived, editable), archetype. Scaffolds the folder with an empty `project.md`, `roadmap.md`, `log.md`, `risks.md`, `questions.md`, and `cards/`.

*Done when:* a project created in the UI is indistinguishable on disk from one written by hand to spec.

---

## B. Brief

### B1. Markdown editor
CodeMirror 6 with markdown syntax highlighting. Edits the body of `project.md`; frontmatter is not shown in the editor and cannot be corrupted by it. Autosave on a 1-second debounce plus an explicit Ctrl+S. Save state is visible ("Saved 14:32").

*Done when:* typing, waiting, and hard-refreshing preserves the text, and the frontmatter block is byte-identical to before the edit.

### B2. Project metadata bar
Stage, health, and archetype as inline editable controls above the editor. Writes frontmatter, not body.

*Done when:* changing stage to `paused` is reflected on the dashboard immediately.

---

## C. Board

### C1. Kanban from files
Columns come from `project.md` frontmatter. Cards come from `cards/*.md`, placed by their `column` and sorted by `order`. Each card shows title, a status chip, priority, size, and confidence.

*Done when:* editing a card file's `column` in a text editor and refreshing moves the card on the board.

### C2. Drag and drop
`@dnd-kit` for both cross-column moves and within-column reordering. The write happens on drop, not on every hover frame.

*Done when:* dragging a card and reloading the page keeps it exactly where it was dropped, and `git diff` on the vault shows only the moved card's file changed.

### C3. Card detail pane
Opens beside the board, not as a modal over it. Shows the card body, acceptance criteria as a live checklist, all metadata as editable fields, backlinks, and an "Enhance with AI" action.

*Done when:* ticking an acceptance criterion writes `- [x]` to the card file.

### C4. Create, edit, delete
New card gets the next free `id`, zero-padded filename, and an `order` at the end of its column. Delete asks once and moves the file to `.trash/` rather than unlinking.

*Done when:* a deleted card is recoverable from `.trash/` by hand.

### C5. Column management
Add, rename, reorder, and remove columns. Removing a column with cards in it is blocked until they are moved.

*Done when:* renaming a column rewrites `column` in every affected card in one pass.

---

## D. AI planning stage

### D1. Synthesize
Turns the brief into a proposal: phases, cards with acceptance criteria, risks, assumptions, and open questions. Streams live progress while it runs — actual steps, not a spinner. Survives the browser tab closing.

*Done when:* a deliberately vague five-line brief produces cards whose content is traceable to something the brief actually said.

### D2. Diff review
The proposal renders as blocks: new card, edited card (before/after), new risk, new question. Each block accepts or rejects independently. Nothing is written until you confirm. Malformed AI output is surfaced raw, never partially applied.

*Done when:* rejecting one card of five results in exactly four new files.

### D3. Snapshot, revert & audit trail
Before any apply, every target file is copied to `.snapshots/<ISO>/` alongside a manifest recording which files were copied and which the apply will create. "Revert last AI change" restores the newest snapshot. Each apply also auto-commits the vault, scoped to the paths it touched, with the proposal summary as the subject — so `git log` becomes the project's decision history and `git revert` a second undo path. A missing or broken vault repo downgrades to a notice and never blocks the write.

*Done when:* apply-then-revert returns the working tree byte-identical to the pre-apply state, and both operations appear as scoped commits in `git log`.

### D4. Enhance card
Sends one card plus the entire brief plus sibling card titles. Returns a rewritten body and acceptance criteria as a proposal — same diff review, same snapshot.

*Done when:* the enhanced body references specifics from the brief rather than generic software-project boilerplate.

### D5. Open Questions queue
A dedicated view. Each question has status open or answered, the answer text, and the run it came from. Answered questions are included as context in every later run. Unanswered count badges the project everywhere it appears.

*Done when:* answering a question and re-running synthesis produces different output that reflects the answer.

### D6. Critique
Reads the whole project and returns gaps, new risks, and new questions. Never edits cards.

*Done when:* running critique on a plan with an obvious hole surfaces that hole as a question rather than silently patching it.

---

## E. Roadmap

### E1. Phase track
Horizontal track of phases from `roadmap.md`, each showing its name, goal, and the cards assigned to it with a done/total count.

*Done when:* moving a card to a different phase in the detail pane moves it on the track.

---

## F. Decision log & risks

### F1. Decision log
Append-only dated entries in `log.md`. Each is a decision, the alternatives considered, and the reason. New entries prepend so the newest is on top.

*Done when:* an entry written today appears above one written yesterday, and nothing in the app ever edits an existing entry.

### F2. Risk & assumption register
Two lists in `risks.md`. Risks carry likelihood and impact (both low/med/high) and a mitigation. Assumptions carry a validated flag. AI runs can propose additions to both; you accept them like anything else.

*Done when:* an unvalidated assumption is visibly distinct from a validated one, and critique can add to the list through the normal proposal path.

---

## G. Cross-project dashboard

### G1. Project table
Every project as a row: name, stage chip, health chip, phase progress, open question count, next action, last touched. Click anywhere to open. Sort by any column. Archived projects hidden behind a toggle.

*Done when:* the dashboard renders in under 100ms for 20 projects with no AI call.

### G2. Next action heuristic
Not an AI call. In priority order: (1) the oldest card marked blocked, (2) unanswered open questions, (3) the highest-priority card in the leftmost non-done column, (4) "No brief yet" if the brief is empty.

*Done when:* answering every open question changes the project's next action to the board item.

---

## H. Links

### H1. Wiki-links
`[[project-slug]]`, `[[project-slug/card-slug]]`, and bare `[[Card Title]]` resolve within the vault. Slug match wins over title match. Unresolved links render visibly different from resolved ones — they are a to-do, not an error.

*Done when:* a link in one project's brief to another project's card navigates correctly.

### H2. Backlinks panel
Every project and every card shows what links to it, with the source line as context.

*Done when:* adding a link in A makes B's backlinks panel show A on refresh.

---

## I. Export

### I1. Agent-ready spec
One action writes a `CLAUDE.md` and a task checklist into a chosen real project folder on disk, derived from the brief, phases, and cards. Preview before write; never clobbers an existing `CLAUDE.md` without showing the diff.

*Done when:* the exported file can be dropped into a repo and gives Claude Code enough context to start the first phase.

---

## Deferred past v1

Listed so they stay out of scope, not because they are bad:

- Graph view of the link network
- Multiple briefs per project
- Templates library beyond the four archetypes
- Card comments / threaded discussion
- Recurring review prompts ("this project hasn't moved in 3 weeks")
- Anthropic API engine as an alternative to the CLI (the adapter exists for it; the implementation does not)
- Import from an existing `BUILDPLAN.md`

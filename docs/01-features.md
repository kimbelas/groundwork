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

**Or start from a repository.** A "Start from" switch at the top of the drawer swaps the two fields for one — a path — and derives the rest: the folder name becomes the project name (`tenant-portal` → "Tenant Portal"), that becomes the slug, and the archetype falls to the server's default rather than being a question asked before there is anything to answer it with. The repo is written into the project's *first* frontmatter, not patched in afterwards, so there is no window in which the project exists unattached to the thing it was made for. The path is validated before the folder is created, which is the ordering that matters: creating first would leave a real, empty project behind every time someone pastes a typo. Blank stays the default, because it is the existing path through this drawer.

Surrounding quotes are stripped from a pasted path. Windows Explorer's "Copy as path" is the one gesture that hands someone an absolute path without typing it, and it wraps the result in `"` — which used to fail with a message about relative paths, true of the string and useless to the reader. The preview is best-effort and the server's answer wins: it canonicalises the path, so the redirect uses the slug that comes back rather than the one shown.

*Done when:* a project created in the UI is indistinguishable on disk from one written by hand to spec, and one created from a repository lands on its brief with the repo already connected.

### A6. Project settings tab
The connected repository (and its search index), export, and delete project. All three lived at the foot of the Brief and none of them belonged there: the Brief is a document you write, and these are things you do to the project as a whole. Stacked under the editor they also pushed the AI panel — the reason you open the Brief — into the middle of a long scroll. Labelled "Settings" like the app-level page in the rail, so a locator on a project page has to be scoped; the project nav carries `aria-label="Project views"` for that. Wrapped in `ProjectDocProvider` because two of the three write `project.md` — connecting a repo patches one field, deleting removes the file — and one baseline per file holds even on a quiet page.

*Done when:* the Brief carries none of the three, the tab reaches all of them, and the audit at 390px passes on the new page.

### A5. Delete project
At the foot of the Brief, below everything the project contains, because you should have to scroll past the plan to reach the button that removes it. Asks in a blocking `ConfirmDialog` that names the project, and moves the whole folder to `vault/.trash/<slug>-<timestamp>/` rather than unlinking it - the same trade as deleting a card, one level up, and the reason the dialog can honestly say nothing is erased. The timestamp keeps two removals of the same slug apart, which also stops the second one failing outright on Windows. Carries `expectedMtimeMs` like every other write: what it protects is not the bytes, which are about to move wholesale, but the user's reading of them - if the project changed after the page loaded, the thing being confirmed is not the thing on disk. Refused outright while an AI run holds the project. The confirmation arrives as a toast, because the page that asked has ceased to exist by the time there is anything to report.

Also offered per row on the dashboard, so removing a scratch project does not mean opening it first. The row's precondition is server-rendered into it — `ProjectEntry` carries `project.md`'s mtime on both its variants — which is what makes the guard mean something: re-reading the mtime on click would only guard the microseconds around the request, while the rendered one guards the whole time the page sat open. Carrying it on the *unreadable* variant too is what lets a project that will not parse be deleted from the UI at all, which is the one a user most wants rid of. Both outcomes report as toasts there, because the row is gone on success and a `Notice` inside a table cell disappears at 390px where the table becomes a stack of cards.

*Done when:* a deleted project is gone from the rail and the dashboard, recoverable by moving one folder back out of `.trash/`, a delete that raced an edit refuses without moving anything, and an unreadable project can be removed without touching the filesystem.

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
Opens beside the board, not as a modal over it. Shows the card's metadata as editable fields, its acceptance criteria as a live checklist the user owns — tick, add, edit in place, remove, reorder, each a one-line write of one file — the "Enhance with AI" action with its history, and a link to the card's own page (C6). It does not show the description or backlinks; the page does. Everything inside the drawer is `CardEditor`, the same component the page renders. Every write in the pane goes through one chain per card, so the baseline each request carries is the one the previous write returned; a card that changed on disk is refused with a reload, never silently overwritten.

*Done when:* ticking an acceptance criterion writes `- [x]` to the card file, and adding one writes exactly one `- [ ] text` line under `## Acceptance criteria` with no other byte changed.

### C4. Create, edit, delete
New card gets the next free `id`, zero-padded filename, an `order` at the end of its column, and an acceptance heading with nothing under it — the first criterion is the user's to write. Delete asks once and moves the file to `.trash/` rather than unlinking.

*Done when:* a deleted card is recoverable from `.trash/` by hand.

### C5. Column management
Add, rename, reorder, and remove columns. Removing a column with cards in it is blocked until they are moved.

*Done when:* renaming a column rewrites `column` in every affected card in one pass.

---

### C6. Card page
Every card has a URL: `/p/<slug>/cards/<id>`. The page shows what the drawer does not — the description, paragraph by paragraph, and what links here — plus the same `CardEditor` (metadata, criteria, enhancements, trash) and a way back to the board. Reached from the link in the drawer header (opens a new tab) or by Ctrl/⌘- or middle-clicking a tile; backlinks and search results point at it. The Board tab stays lit on it. A card whose frontmatter did not parse renders the page with a notice rather than a 500; an unknown or malformed id is a 404. The description is read-only for now — an enhance apply replaces that region, and a second writer beside a pending review is the wrong first experience of the page — and `Prose` renders inline emphasis only, so a heading or list inside a description shows as its literal markdown.

*Done when:* a card with a two-paragraph description, two criteria and one backlink renders all three on its page, Ctrl-clicking its tile opens that page in a new tab, and `/cards/999` is a 404.

## D. AI planning stage

### D1. Synthesize
Turns the brief into a proposal: phases, cards with acceptance criteria, risks, assumptions, and open questions. Streams live progress while it runs — actual steps, not a spinner. Survives the browser tab closing.

**And survives leaving the page.** Because the run outlives the response that started it, a tab switch used to abort the stream and leave synthesis working with nothing on screen saying so — the panel came back with enabled buttons over a still-locked project. The brief page now asks `activeRunFor` alongside `pendingRunFor`, adopts an in-flight run at render time, and polls its record: buttons stay disabled, elapsed time keeps counting, and the review opens by itself when it finishes. An adopted run shows elapsed time instead of the step list, because steps are streamed rather than stored and the stream belongs to whichever tab opened it.

*Done when:* a deliberately vague five-line brief produces cards whose content is traceable to something the brief actually said, and a page opened while a run is in flight says so rather than offering to start another.

### D2. Diff review
The proposal renders as blocks: new card, edited card (before/after), new risk, new question. Each block accepts or rejects independently. Nothing is written until you confirm. Malformed AI output is surfaced raw, never partially applied.

*Done when:* rejecting one card of five results in exactly four new files.

### D3. Snapshot, revert & audit trail
Before any apply, every target file is copied to `.snapshots/<ISO>/` alongside a manifest recording which files were copied and which the apply will create. "Revert last AI change" restores the newest snapshot. Each apply also auto-commits the vault, scoped to the paths it touched, with the proposal summary as the subject — so `git log` becomes the project's decision history and `git revert` a second undo path. A missing or broken vault repo downgrades to a notice and never blocks the write.

*Done when:* apply-then-revert returns the working tree byte-identical to the pre-apply state, and both operations appear as scoped commits in `git log`.

### D4. Enhance card
Sends one card plus the entire brief plus sibling card titles. Returns an expanded description and *additional* acceptance criteria as a proposal — same diff review, same snapshot. The card's own criteria are the base the model adds to: every one the user wrote survives an apply with its text, its tick and its position, whether or not the model returned it, and the review labels each as kept, kept-though-omitted, or added. The description is the one thing replaced, and the review shows it before and after. The apply carries the baseline the review was computed against; a card edited in between is a 409 with a reload, not a merge over a body nobody saw.

An enhancement persists per card. The run record carries the card's id, so reopening the card — in the drawer or on its page — offers a finished, unapplied proposal again as the review without another model run; the button then reads "Run again". A run still in progress when the drawer closed is watched to its end. Every run the card has had is listed underneath with its outcome (applied when, not applied, failed why), and "view" shows what was proposed — the proposal itself, never a diff against the current card, which would read as false once applied. The brief page never offers a card's enhancement: pending proposals are found by job and card, not by "newest ready".

*Done when:* the enhanced body references specifics from the brief rather than generic software-project boilerplate, a ticked hand-written criterion is still ticked, verbatim, after the apply, and closing and reopening the card shows the finished review without a second run.

### D5. Open Questions queue
A dedicated view. Each question has status open or answered, the answer text, and the run it came from. Answered questions are included as context in every later run. Unanswered count badges the project everywhere it appears.

*Done when:* answering a question and re-running synthesis produces different output that reflects the answer.

### D5b. Suggested answers
On the Questions tab, **Suggest answers** runs a `suggest-answers` job over the open questions and offers up to three candidate answers each, with one line on why and what it costs. The manual box stays underneath as the fourth option, undressed on purpose — it was already there, and styling it as a card would suggest it is another suggestion.

Choosing an option **fills the box, it does not commit it.** The answer becomes a confirmed fact handed to every later run, so the last edit before it becomes one is the user's; a one-click store makes a misread option permanent. Each option says whether it is *quoted from the brief* or *inferred, not stated* — the distinction matters more here than anywhere else in the app, because an inference that reads as a decision the project already made is the one thing that corrupts the record it feeds.

Three is what the prompt asks for; one is what the schema tolerates. A hard minimum would throw away a whole run because the model could only find two honest answers to one question out of ten — the same failure shape as a single absent `groundedIn` invalidating a proposal of sixteen cards. Nothing is written to the vault: the run's output is read from the run directory, and only what the user clicks and saves is stored.

*Done when:* a question with three options and a question with one both render correctly, choosing an option leaves it editable, and answering by hand with no run at all still works.

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
One action writes a `CLAUDE.md` and a `TASKS.md` into a chosen real project folder on disk, derived from the brief, phases, cards, questions, risks and the decision log. Choosing the folder and reading what would be written happens in a drawer; replacing an existing file is a blocking confirmation that names the files and shows the contents at risk.

`CLAUDE.md` carries the brief **verbatim** rather than a summary — a summary would be this app's opinion about the user's own words — and carries open questions *as open questions*, so an agent asks instead of inventing. `TASKS.md` is a checklist grouped by phase, with cards in the Done column already ticked; it deliberately does not repeat acceptance criteria, which live in the cards and would be a second copy to drift.

The target folder must already exist and may be neither the vault nor Groundwork's own directory. The confirmation is a **precondition**: the write carries the list of files the browser showed as being replaced, the server reads the folder again, and anything it would replace that is not on that list stops the write. A file created between the preview and the click cannot vanish under it.

See the write contract in [02-architecture.md](02-architecture.md).

*Done when:* the exported file can be dropped into a repo and gives Claude Code enough context to start the first phase.

---

## J. The connected repository

The thing this app is really for: have an idea, create the project, connect the repo — and
planning is grounded in the code that exists, not only in what the brief claims.

### J1. Connect a repository
One optional `repo` field in `project.md` frontmatter, set from a panel on the brief page and
hand-editable in Obsidian like everything else. No registry, no lifecycle. The path is
validated on connect: absolute, no NUL byte, and refused if it contains the vault or sits
inside it — either nesting would let repo-grounded planning quote the vault's own prose as
though it were source. Reads are **read-only**, enforced by a test that fails if a writing
`fs` call appears in `lib/repo.ts`.

*Done when:* a connected repo survives a restart, and disconnecting leaves no trace in
frontmatter.

### J2. The code index
Chunks the repo on line boundaries, hashes each file on normalised content, and embeds only
what changed — so a second build after one commit re-embeds that commit and nothing else.
Hashing rather than trusting the git SHA, because uncommitted edits are exactly the state a
developer is in when they ask about their own code. Vectors are raw Float32 rather than JSON,
which is 8 MB instead of 40 for a 5,000-chunk repo.

Embeddings are **optional**: on a machine that has never fetched the model, retrieval
degrades to keyword-only and says so. Keyword search is not a fallback but a peer — ask an
embedding model for `expectedMtimeMs` and it returns things *about* preconditions rather than
the four places that symbol appears.

The index lives in `.groundwork/index/`, is git-ignored, and is never authoritative: every
read returns `null` rather than throwing, because the fix for anything wrong with derived
data is to rebuild it.

*Done when:* building twice in a row does no work the second time, and a machine without the
embedding model still gets useful results and is told why they are keyword-only.

### J3. Planning grounded in the code
A run with a connected repository is handed a file of retrieved excerpts and told the
repository itself is unreachable — because it is: the app reads the repo in process and the
run never learns where it is. A claim about existing code carries a citation
(`path:startLine-endLine` plus a verbatim quote), checked by plain string match against the
excerpts the run was actually given. The review shows the citation as evidence and flags one
it cannot verify.

Every run states what the repository contributed — how many excerpts, ranked how, or why
none. A reader who believes the plan was checked against their code when it was not will
trust it further than they should.

*Done when:* a synthesize run on a repo-connected project produces a card citing a real file
and line, an invented citation is flagged in review, and a project with no repository behaves
exactly as before.

---

## K. Settings

### K1. Which Claude account is connected
`/settings`, from the bottom of the rail. It asks the CLI — `claude auth status --json` — and says who is signed in (email, organisation, plan, and whether that is a Claude subscription or Anthropic Console billing), or one of: the CLI is installed but signed out, the CLI is not where the app looks, or the CLI could not be read. Each of those states carries the exact commands to run (`claude auth login`, `npm i -g @anthropic-ai/claude-code`, or `GROUNDWORK_CLAUDE_CMD`) with a copy button, and a Re-check button that asks again. The app cannot sign in on the user's behalf: the login is an interactive browser flow that belongs to the CLI. The answer is never read from the CLI's own files — on the machine this was built on, `~/.claude.json` named a different account than the CLI did. Cached for a minute; the brief page's AI actions and the card's Enhance button read the same answer and disable themselves with a link here when no account is connected.

*Done when:* with `GROUNDWORK_CLAUDE_CMD` pointed at a path that does not exist, Settings says so with the install steps and both run buttons are disabled with a link to it.

## Deferred past v1

Listed so they stay out of scope, not because they are bad:

- Graph view of the link network
- Multiple briefs per project
- Templates library beyond the four archetypes
- Card comments / threaded discussion
- Recurring review prompts ("this project hasn't moved in 3 weeks")
- Anthropic API engine as an alternative to the CLI (the adapter exists for it; the implementation does not)
- Per-criterion accept in the review, and a per-criterion "Sharpen" AI action (designed in [06-roadmap.md](06-roadmap.md); the merge is built to take it)
- Import from an existing `BUILDPLAN.md`

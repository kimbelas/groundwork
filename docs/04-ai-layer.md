# 04 — AI layer

The whole design of this layer follows from one decision: **the AI is a proposer, not a writer.** It never touches `vault/`. It produces a JSON proposal, the app validates it, the user accepts parts of it, and only then does anything land on disk — after a snapshot.

## Engine

AI work runs through the Claude Code CLI already installed on the machine. The location is
not hard-coded to anyone: on Windows it is derived from `APPDATA` (npm puts its global
shims under `%APPDATA%/npm`), elsewhere the binary is spawned from `PATH`, and
`GROUNDWORK_CLAUDE_CMD` overrides both.

Deriving beats a bare `PATH` lookup here, because npm global is often missing from the
environment a dev server inherits. Reasons the CLI beats the API for v1:

- No API key to manage, no per-token cost — it rides the existing subscription.
- It can read the vault (and, for export, the real project folder) with its own tools.
- The streaming progress pattern is already written and working in `claude-coach/app/api/run/route.ts`.

It sits behind `AiEngine` so an `anthropic-api.ts` implementation can be dropped in later with no UI change.

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

## Jobs

| Job | Reads | Produces | Never does |
|---|---|---|---|
| `synthesize` | brief, archetype, answered questions, existing cards | phases, new cards, risks, assumptions, questions | delete anything |
| `enhance-card` | one card, the full brief, sibling card titles | rewritten body + acceptance criteria for that card | touch other cards |
| `critique` | the whole project | gaps, new risks, new questions | edit cards |

`synthesize` on a project that already has cards is an **update**, not a reset: existing cards may appear as edits, and the model is told explicitly not to propose deleting work the user has done.

### What is not an AI job

The dashboard's **next action** is a heuristic in `lib/nextAction.ts`, evaluated in order:

1. The oldest card with `blocked: true`
2. Unanswered open questions, if any
3. The highest-priority card in the leftmost non-done column
4. "No brief yet" if the brief body is empty

The dashboard must render instantly and cost nothing. Anything that would require spawning a process to render a list is the wrong design.

## Invocation

Prompts live as markdown files in `prompts/` and the CLI is told to read and execute one — the same indirection claude-coach uses, which keeps prompt text out of TypeScript string literals and makes it editable without a rebuild.

```ts
const runId = makeRunId()
const runDir = path.join(ROOT, '.groundwork', 'runs', runId)
const outPath = path.join(runDir, 'proposal.json')

const instruction =
  `Read prompts/synthesize.md and execute it for the project at ` +
  `"vault/${slug}". Write your result as JSON to "${outPath}". ` +
  `Do not modify any file inside vault/.`

spawn('cmd', ['/c', CLAUDE_CMD, '-p', instruction, '--output-format', 'stream-json', '--verbose'], {
  cwd: ROOT,
  windowsHide: true,
})
```

Arguments are passed as an array, never as a shell string. The `cmd /c` wrapper is what executes a `.cmd` on Windows without `shell: true` — this mirrors the working invocation at `claude-coach/app/api/run/route.ts:66` verbatim.

### Headless permissions

In `-p` (print) mode there is no human to approve tool calls: anything not pre-allowed is denied, and the run dies at its first Write. claude-coach solves this with repo-level allow rules in `.claude/settings.json`; Groundwork does the same, with one deliberate asymmetry:

```jsonc
// groundwork/.claude/settings.json (excerpt)
"allow": [
  "Read(./**)",
  "Write(.groundwork/runs/**)"    // and pointedly NOT Write(vault/**)
]
```

Write permission exists only under the run directory. "Do not modify any file inside vault/" stops being a polite sentence in the prompt and becomes a rule the harness enforces — a confused run that tries to edit the vault is auto-denied, not trusted.

### Streaming progress

The CLI's stream-json events are mapped to human-readable steps and pushed over SSE. Port the `friendly(toolName, input)` function from `claude-coach/app/api/run/route.ts` — it already turns `Read` into "Reading billing-api.md", `Grep` into "Searching", and so on.

Progress must show what is actually happening. A spinner for a three-minute run tells the user nothing and makes a working process look hung.

### Surviving disconnect

Hold the child process in a module-level variable rather than tying its lifetime to the response stream, exactly as claude-coach does. Closing the tab must not kill a synthesis run. Stopping is explicit: `GET /api/ai/run?action=stop`.

If the tab is gone when the run finishes, the proposal is still on disk. The project shows a "proposal ready" banner on next load.

### Locking

`.groundwork/run.lock` holds the current runId and start time. A second run attempt returns 409 with a message naming what is already running. A lock older than 30 minutes is considered stale and can be broken from the UI.

## Proposal schema

Validated with zod before anything else happens.

```ts
const Proposal = z.object({
  runId: z.string(),
  job: z.enum(['synthesize', 'enhance-card', 'critique']),
  slug: z.string(),
  summary: z.string(),                 // one paragraph, shown above the diff
  phases: z.array(Phase).default([]),
  cards: z.array(CardProposal).default([]),
  risks: z.array(RiskProposal).default([]),
  assumptions: z.array(AssumptionProposal).default([]),
  questions: z.array(QuestionProposal).default([]),
})

const CardProposal = z.object({
  op: z.enum(['create', 'update']),    // no 'delete' — the AI never removes work
  id: z.number().optional(),           // required for update
  title: z.string(),
  phase: z.number().optional(),
  column: z.string().optional(),
  priority: z.enum(['P1', 'P2', 'P3']),
  size: z.enum(['S', 'M', 'L']),
  confidence: z.number().min(0).max(1),
  body: z.string(),
  acceptance: z.array(z.string()),
  groundedIn: z.string().nullable(),   // verbatim quote from the brief, or null
  groundedInCode: GroundedInCode.nullable().optional(),   // a claim about existing code
})

const GroundedInCode = z.object({
  path: z.string(),                    // repo-relative, as the excerpt heading spells it
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  quote: z.string(),                   // verbatim from that excerpt
})
```

`groundedIn` is the anti-invention mechanism. It must be a **verbatim substring of the brief**, checked with a plain string match at validation time — no model involved, so the check itself cannot hallucinate. A quote that doesn't match renders the card flagged **ungrounded** in the diff. `null` is allowed and honest: it renders as **inferred, not stated**, which is exactly the distinction the user needs to see. Template filler becomes obvious at a glance because it has nothing to quote.

`groundedInCode` is the same mechanism for a claim about *existing code*, and it has three
states that must not be collapsed: **absent** means this run had no code to cite, **null**
means the code was read and settled nothing, and an **object** is a positive assertion the
app goes and checks. There is deliberately no `.default()` anywhere in that chain — zod's
`.default()` consumes `undefined`, so a default would turn silence into a citation and
fabricate evidence.

It is structured rather than one `"path:12-40 — quote"` string because both halves are
checked separately: the heading must name an excerpt the app actually showed the model, and
the quote must appear **in that excerpt** rather than anywhere in the file. Quoting one file
while citing another is the shape a plausible wrong answer takes, and a whole-file match
would wave it through.

Whitespace is forgiven on a second attempt; case is not. Code arrives re-indented through
JSON escaping, which is not paraphrase — but `orderFor` and `orderfor` are different
symbols, so a mis-cased identifier is a quote from memory. Unverified code citations get
their own warning sentence above the diff, never merged with the brief's count: one is a
claim about what the user asked for, the other about what their code already does, and a
reader who trusts a wrong code citation goes and edits the wrong file.

Citations are review-time evidence and are not written into the vault, the same as
`groundedIn`.

Proposals never assign ids — `lib/vault.ts` assigns card and question ids at apply time, so the model cannot collide with existing ones.

If validation fails, the run is marked failed and the **raw output is shown to the user**. It is never partially applied and never silently discarded.

## Repository context

When a project has a repository connected, planning is grounded in the code as well as the
brief. The mechanism is one file.

Before any process is spawned, `app/api/ai/run` calls `buildRepoContext` in
`lib/ai/context.ts`. It derives a small query set from the project — headings and their
first lines for synthesize and critique, title and acceptance criteria for enhance-card —
searches the index for each, merges the hits round-robin so one broad query cannot crowd out
the rest, and writes at most 8 excerpts / 6 KB to
`.groundwork/runs/<runId>/context/repo-excerpts.md`. Each excerpt is headed with
`path:startLine-endLine` and fenced verbatim, with the fence sized to the content so a
markdown file full of backticks cannot break out of it.

**The run is never told where the repository is.** Its permissions are a denylist anchored at
the app root, so a path outside that root is unprotected rather than merely unlisted; the
instruction names the excerpt file and states that the repository is unreachable, and
`assertInstructionScoped` fails any spawn whose instruction says otherwise. The excerpt file
also has the repo path redacted out of chunk *text*, in both separator spellings and
case-insensitively — a repo can contain its own absolute path in a config or a committed
log, and that file is a legitimate retrieval hit. Nothing asserts on that file at spawn
time, so the redaction is covered by a test instead.

Retrieval **never fails a run**, the same rule as `lib/git.ts`. Six outcomes are recorded on
the run record and stated on the review: excerpts included (with how many, and whether
semantic ranking took part), no repository connected, a repository never indexed, an index
built from a *different* repository than the one now connected, nothing relevant found, or
something went wrong. Saying which one happened is not decoration: a reader who believes the
plan was checked against their code when it was not will trust it further than they should,
and the four failure modes have four different fixes.

The status is recorded before the engine starts, so a failed run still says what it was
working from — which is exactly when someone asks.

## Diff review

The proposal renders as independent blocks. Each accepts or rejects on its own.

| Block | Shows |
|---|---|
| New card | Title, metadata, body, acceptance criteria, grounding quote or "inferred" flag |
| Card update | Field-level before/after, body diff |
| New phase | Number, name, goal |
| New risk / assumption | Text, likelihood, impact, mitigation |
| New question | The question, and what it is blocking |

Accept-all and reject-all are available, but the per-block controls are the default posture. A single "Apply" button is how other tools quietly overwrite your work.

## Apply

On confirm, in order:

1. Compute the exact file set the accepted blocks will touch.
2. Copy each of those files to `vault/<slug>/.snapshots/<ISO>/`, preserving relative paths, and write a `manifest.json` naming the runId, the copied files, and the files the apply will create.
3. Write through `lib/vault.ts` — never directly.
4. Stamp `updated` on the project.
5. Record the applied runId so revert knows what it is undoing.

Rejected blocks are recorded in the run directory too. Knowing what you turned down is useful when a later run proposes it again.

## Revert

"Revert last AI change" restores the newest snapshot directory: every copied file goes back over its original path, and the files its `manifest.json` lists as created are moved to `.trash/`. The manifest is what makes "created by the apply" distinguishable from "always existed".

Snapshots are not pruned automatically. They are small, and deleting someone's undo history to save disk is a bad trade.

## Vault auto-commit

Every accepted apply commits the vault. `lib/git.ts` stages **only the paths the apply touched** and commits exactly those:

```
git add -- <paths>
git commit -m <message> -- <paths>
```

Scoping to explicit paths matters. `git commit -a` would sweep in unrelated hand-edits sitting in the working tree from other projects, which turns an audit trail into noise.

Message format:

```
ai(synthesize): lock the billing contract before touching the portal

Run: run_20260818_1403
Accepted: 4 cards, 2 risks, 3 questions
Rejected: 1 card
```

The subject is the proposal's `summary`, so `git log --oneline` reads as the decision history of the project. Revert commits the same way, with an `revert(ai):` subject naming the run it undid — history stays append-only rather than silently rewinding, and `git revert` becomes a second undo path behind snapshots.

Three rules keep this from becoming a liability:

- **It can never fail an apply.** No `vault/.git`, no `git` on PATH, a hook rejecting the commit, an empty diff — all are logged and surfaced as a non-blocking notice. The files are already written; the commit is bookkeeping. An audit trail that can break the feature it audits is a worse trade than no audit trail.
- **Only AI applies commit.** Human edits accumulate in the working tree. A commit per autosave debounce would bury the signal completely.
- **Uncommitted human edits to a touched file ride along.** If you edited the brief and didn't commit, the apply's commit includes that edit — the file is committed as it stands. The commit body notes when this happened rather than pretending the diff is purely the model's.

Auto-commit is a setting, default on, and silently disabled when `vault/.git` is absent.

## Prompt design

The prompt files are as much of the product as the code. Rules that go in all three:

- **Ground everything.** Every card must trace to something the brief says. Anything that does not is a question, not a card.
- **Prefer a question to a guess.** The Open Questions queue exists so that the model has somewhere to put uncertainty. An empty questions array on a vague brief is a failure, not a success.
- **No filler phases.** "Testing" and "Deployment" as standalone phases on every project are template output. If testing matters here, it belongs in acceptance criteria.
- **Match the vocabulary of the brief.** If the user wrote "tenants," do not return "customers."
- **Size and confidence honestly.** Low confidence on genuinely unclear work is the correct answer and is more useful than false precision.
- **Never propose deletions.** The user's work is not the model's to remove.
- **Write acceptance criteria that could fail.** "Works correctly" is not a criterion. "Webhook handling is idempotent" is.
- **Cite the code, or say nothing about it.** When a project has a connected repository the run is handed a file of excerpts and told the repository itself is unreachable. A claim about what the code already does carries `groundedInCode` quoting one of those excerpts verbatim; an invented citation is worse than omitting the field.
- **Say when the code contradicts the brief.** Excerpts showing work already done, or done differently, are the most valuable thing retrieval surfaces. A card proposing what already exists is worse than no card — prefer an update, or a question naming the discrepancy.

Archetype (`saas-mvp`, `internal-tool`, `client`, `research-spike`) is injected into the prompt and shifts emphasis — a research spike wants questions and a kill-criterion, a client project wants scope boundaries and a decision log entry per assumption.

### Probe fixtures

Prompt files are product surface with no type system and no test. Editing `synthesize.md` to fix one behaviour will silently degrade another, and nothing in the app would tell you.

`fixtures/briefs/` holds probe briefs written to bait a specific failure. Each pairs a brief with an `## Expectations` section stating what a good run does with it — questions it should ask, vocabulary it must not swap, cards it must not invent. After any prompt edit, run the probes against a scratch project and read the output against the expectations.

This is manual and deliberately so. Judging "did this get worse" is the part that needs a human; the automation worth building later is only the diffing of one run against the last, which is what the Phase 5 `/eval-prompts` skill does.

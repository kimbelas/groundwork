# Synthesize

Turn a project's brief into a structured plan proposal.

You will be told a project folder (`vault/<slug>`) and an output path. Read the project,
write one JSON document to the output path, and change nothing else.

## Read first

- `project.md` — the frontmatter is metadata; **the body is the brief**, and it is the
  only real source of truth here.
- `questions.md` — every question with `status: answered` is a fact the user has
  confirmed. Treat answers as authoritative and never re-ask them.
- `cards/*.md` — work that already exists.
- `roadmap.md`, `risks.md` — existing phases and the risk register.

## Rules

**Ground everything.** Every card, risk and assumption carries `groundedIn`: either a
**verbatim quote from the brief** — copied exactly, not paraphrased — or `null`, meaning
"inferred, not stated". The app checks quotes by string match and flags any that are not
in the brief, so an invented quote is worse than an honest `null`.

**Ground a claim about existing code in the code.** When a repository is connected you
will be told to read a file of repository excerpts. It is the only view of that code you
have — the repository itself is not reachable, so do not go looking for it. Any card,
risk or assumption that asserts something about what the code already does carries
`groundedInCode`: the excerpt's own heading, split into `path`, `startLine` and `endLine`,
plus a `quote` copied from that excerpt **verbatim**. The app checks the quote by exact
string match against the same file, so an invented citation is worse than omitting the
field. Omit it entirely when a claim is not about existing code; use `null` when it is
about the code but nothing in the excerpts settles it.

**Say when the code contradicts the brief.** Excerpts that show the work already done, or
done differently, are the most valuable thing retrieval can surface. A card proposing what
already exists is worse than no card — prefer an update, or a question naming the
discrepancy.

**Prefer a question to a guess.** Anything the brief does not settle belongs in
`questions`, not in a confidently-worded card. An empty `questions` array on a vague
brief is a failure, not a success.

**Never propose deletions.** `op` is `create` or `update` only. On a project that
already has cards this is an *update*: propose changes to what exists and additions
around it, and do not restate finished work as new.

**No filler phases.** "Setup", "Development", "Testing", "Deployment" and "Launch" as
standalone phases are template output. Phases are named after this project's actual
stages. If testing matters here, it belongs in acceptance criteria.

**Acceptance criteria must be able to fail.** "Works correctly", "is performant" and
"has good coverage" are not criteria. "Two agencies with different word-count
definitions produce different effective rates" is.

**Match the brief's vocabulary.** If it says *tenants*, do not write *customers*. If it
says *units*, do not write *properties*. Renaming the user's domain is how a plan stops
being about their business.

**Use these exact values.** `priority` is `P1`, `P2` or `P3`. `size` is `S`, `M` or `L`.
`likelihood` and `impact` are `low`, `med` or `high` — `med`, not `medium`. `confidence` is a
number between 0 and 1. A value outside these lists fails validation and the whole proposal
is rejected, including the parts that were right.

**Size and confidence honestly.** `size` is S/M/L; `confidence` is 0–1 and means "how
well is this understood", not "how likely to succeed". Low confidence on genuinely
unclear work is the correct answer and more useful than false precision. Never estimate
hours.

**Let the archetype steer emphasis.** `research-spike` wants questions and a kill
criterion; `client` wants scope boundaries and explicit assumptions; `saas-mvp` wants the
shortest path to something worth paying for; `internal-tool` wants the current manual
process captured before it is replaced.

## Output

Write exactly this shape as JSON. No markdown fence, no commentary.

```json
{
  "runId": "<the run id from the output path>",
  "job": "synthesize",
  "slug": "<project slug>",
  "summary": "One paragraph on what you proposed and why.",
  "phases": [{ "n": 1, "name": "Intake", "goal": "..." }],
  "cards": [
    {
      "op": "create",
      "title": "...",
      "column": "<one of the project's declared columns>",
      "phase": 1,
      "priority": "P1",
      "size": "M",
      "confidence": 0.6,
      "body": "What this is and why it exists.",
      "acceptance": ["A criterion that could fail"],
      "groundedIn": "verbatim quote from the brief, or null",
      "groundedInCode": {
        "path": "lib/ordering.ts",
        "startLine": 40,
        "endLine": 43,
        "quote": "verbatim text from that excerpt"
      }
    }
  ],
  "risks": [
    {
      "text": "...",
      "likelihood": "high",
      "impact": "high",
      "mitigation": "...",
      "groundedIn": null
    }
  ],
  "assumptions": [{ "text": "...", "groundedIn": null }],
  "questions": [{ "text": "...", "blocks": "what this is holding up" }]
}
```

`groundedInCode` is optional everywhere it appears: omit it, or set it to `null`. It also
belongs on a risk or an assumption drawn from the code.

`op: "create"` must **not** include an `id` — the app assigns them. `op: "update"` must
include the `id` of the card it changes.

## Do not

- Do not create, edit or delete anything under `vault/`. The app applies changes only
  after the user has reviewed them; writing there directly bypasses the review, the
  snapshot and the user's judgement.
- Do not set `stage` or `health`. Those are human judgements.
- Do not invent a technology stack the brief does not mention.
- Do not cite a file that is not in the excerpts, and do not cite a line range you have
  not read. There is no partial credit: an unverifiable citation is shown to the user as a
  warning next to your card.

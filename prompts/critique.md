# Critique

Find what the plan is missing. Propose no card edits at all.

You will be told a project folder (`vault/<slug>`) and an output path. Read, write one
JSON document to the output path, and change nothing else.

## Read first

Everything: `project.md`, every card in `cards/`, `roadmap.md`, `risks.md`,
`questions.md`, and `log.md`. Critique of a plan you have only skimmed is worthless.

## What you are looking for

**Gaps between the brief and the cards.** Something the brief asks for that no card
delivers. This is the highest-value finding and the easiest to miss, because the cards
that exist all look reasonable on their own.

**Unstated dependencies.** Two cards that cannot both be true, or one that silently
assumes another has finished.

**Risks the plan does not acknowledge.** Especially where the brief names a constraint —
a legacy system, a deadline, a single person who knows something — that no card and no
risk entry mentions.

**Assumptions being treated as facts.** Anywhere the plan proceeds as though an open
question were settled.

**Sequencing that will not survive contact.** A phase whose goal depends on an answer
that phase does not produce.

## Rules

**Propose no cards.** `cards` must be empty. This job exists so a plan can be examined
without being quietly rewritten; the moment you start editing, the user loses the ability
to tell a critique from a revision.

**A finding is specific or it is noise.** "Consider security" helps nobody. "Nothing
covers what happens to work orders raised while a building is mid-cutover" is a finding.

**Say nothing rather than pad.** A plan with two real gaps should produce two findings.
Filling the list to look thorough is the failure mode of this job.

**Do not re-ask an answered question.** Anything in `questions.md` with
`status: answered` is settled.

**Do not re-raise an existing risk.** Check `risks.md` first. A duplicate risk makes the
register less useful, not more.

**Use these exact values.** `priority` is `P1`, `P2` or `P3`. `size` is `S`, `M` or `L`.
`likelihood` and `impact` are `low`, `med` or `high` — `med`, not `medium`. `confidence` is a
number between 0 and 1. A value outside these lists fails validation and the whole proposal
is rejected, including the parts that were right.

**`groundedIn` is a verbatim quote from the brief, or `null`.** For a critique, `null` is
often correct — you are usually pointing at an *absence*, which cannot be quoted.

**`groundedInCode` is how a critique stops being generic.** If you were told to read a file
of repository excerpts, it is the only view of the connected repository available — the
repository itself is not reachable, so do not go looking for it. A risk the code itself
demonstrates carries `groundedInCode`: the excerpt's heading as `path`, `startLine`,
`endLine`, plus a `quote` copied verbatim. Checked by exact string match; an invented
citation is worse than omitting the field.

The strongest thing you can do here is name a place where the plan and the code disagree —
work the brief treats as remaining that the excerpts show already done, or done differently.
That is a real finding. "Consider adding tests" is not.

## Output

```json
{
  "runId": "<the run id from the output path>",
  "job": "critique",
  "slug": "<project slug>",
  "summary": "One paragraph: what is most at risk of going wrong, and why.",
  "cards": [],
  "risks": [
    {
      "text": "...",
      "likelihood": "med",
      "impact": "high",
      "mitigation": "...",
      "groundedIn": null,
      "groundedInCode": null
    }
  ],
  "assumptions": [{ "text": "...", "groundedIn": null }],
  "questions": [{ "text": "...", "blocks": "what this is holding up" }]
}
```

## Do not

- Do not create, edit or delete anything under `vault/`.
- Do not set `stage` or `health`. Those are human judgements.
- Do not propose phases; sequencing concerns belong in a question or a risk.

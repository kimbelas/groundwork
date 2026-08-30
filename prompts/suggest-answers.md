# Suggest answers

Propose candidate answers to a project's **open questions**. You are not answering them —
the user is. You are saving them from typing the obvious ones from scratch.

You will be told a project folder (`vault/<slug>`) and an output path. Read the project,
write one JSON document to the output path, and change nothing else.

## Read first

- `questions.md` — the questions themselves. **Only ones with `status: open`.** A question
  already answered is a decision the user has made; proposing an alternative invites a
  click that overwrites their own words.
- `project.md` — the frontmatter is metadata; **the body is the brief**.
- `cards/*.md`, `roadmap.md`, `risks.md` — what is already planned.

## Length is the hard rule

**Every option is ONE sentence.** Not two. Not a sentence with a semicolon doing the work
of two. Under 200 characters, and the app refuses anything longer.

**`because` is one short clause**, under 140 characters — the trade-off, not an argument.
"Avoids a migration; moves the release out." is the whole shape.

**`summary` is one sentence** about the set of questions, under 240 characters.

This is the rule most worth following. These options are read stacked, three at a time,
above the box the user answers in. A paragraph per option is a wall in front of the thing
they came to do, and it gets skipped — which makes a good suggestion worth nothing.

Write plainly. No hedging ("probably", "it seems", "you might want to"), no restating the
question, no explaining what the project is. The reader knows.

## What a good option is

**A decision, not a description.** "Pay at intake only for v1." is an answer. "It depends
how the business operates." is the question restated, and it wastes one of three slots.

**Different from the others.** Three phrasings of one answer is one answer. Prefer options
that lead to *different work*: the cheap one, the thorough one, and the one that defers the
decision cleanly.

**Recommend exactly one.** Set `recommended: true` on the single option you would pick, and
`false` on the rest. One per question — a badge on everything says nothing. If you genuinely
cannot choose, set it `false` on all of them rather than marking two.

## Rules

**Three options per question.** If you can only think of two honest ones, give two. Never
pad to three with a restatement: a filler option is worse than a missing one, because a
person reads it, considers it and discards it.

**Ground every option.** Each carries `groundedIn`: a **verbatim quote from the brief**,
copied exactly, or `null` meaning "a reasonable inference, not something the project has
said". The app checks quotes by string match. An invented quote matters more here than
anywhere else in this app: the user is about to click one of these and store it as a fact,
and a fabricated citation makes a guess look like a decision they already made.

**Ground a claim about existing code in the code.** When a repository is connected you will
be told to read a file of repository excerpts. It is the only view of that code you have —
the repository itself is not reachable, so do not go looking for it. An option asserting
something about what the code already does carries `groundedInCode`: the excerpt's own
heading, split into `path`, `startLine` and `endLine`, plus a `quote` copied verbatim. Omit
the field when you had no code to read; use `null` when you read it and it settled nothing.

**Never invent a question.** `questionId` must be an `id` that exists in `questions.md` with
`status: open`. Anything else is dropped by the app.

## Output

One JSON document at the output path:

```json
{
  "runId": "<the run id you were given>",
  "job": "suggest-answers",
  "slug": "<the project slug>",
  "summary": "One sentence about what these questions have in common.",
  "questions": [
    {
      "questionId": "q3",
      "options": [
        {
          "text": "One sentence: the answer the user would store.",
          "because": "The trade-off, in a clause.",
          "recommended": true,
          "groundedIn": "a verbatim quote from the brief, or null",
          "groundedInCode": null
        }
      ]
    }
  ]
}
```

Write nothing inside `vault/`. The app shows these to the user, and only what they click is
ever stored.

# Enhance card

Expand one card into a specification that fits the plan around it.

You will be told a project folder (`vault/<slug>`), a card id, and an output path. Read,
write one JSON document to the output path, and change nothing else.

## Read first

- `project.md` — **the body is the brief.** Read all of it, not just the first
  paragraph. The whole point of this job is that the expansion fits the overall plan.
- The card itself, in `cards/`.
- The **titles** of the sibling cards, so you neither duplicate their work nor contradict
  their boundaries.
- `questions.md` — answered questions are confirmed facts. Open ones are things you must
  not assume.

## Rules

**Expand, do not replace.** The user wrote this card for a reason. Keep its intent and
its title unless the title is actively wrong; add the specifics that were missing.

**Reference the brief, not the genre.** A good expansion contains details that could only
come from this project. If what you wrote would fit any project of this type, it is
filler and you should write less.

**Stay inside this card.** Work that belongs to a sibling card belongs there. If you find
scope that has no card, raise it as a question rather than absorbing it.

**Acceptance criteria must be able to fail.** Each one names an observable outcome. Three
sharp criteria beat eight vague ones.

**`groundedIn` is a verbatim quote from the brief, or `null`.** Copy it exactly; the app
checks by string match. `null` means "inferred, not stated" and is the honest answer when
you are extrapolating.

**Confidence reflects understanding.** If the card is still unclear after reading the
brief, say so with a low number and a question — do not paper over it with detail.

## Output

Exactly one `update` card, carrying the id you were given.

```json
{
  "runId": "<the run id from the output path>",
  "job": "enhance-card",
  "slug": "<project slug>",
  "summary": "One sentence on what you changed and why.",
  "cards": [
    {
      "op": "update",
      "id": 7,
      "title": "...",
      "priority": "P1",
      "size": "M",
      "confidence": 0.6,
      "body": "The expanded description.",
      "acceptance": ["A criterion that could fail"],
      "groundedIn": "verbatim quote from the brief, or null"
    }
  ],
  "questions": [{ "text": "...", "blocks": "what this is holding up" }]
}
```

Omit `phases`, `risks` and `assumptions` unless expanding the card genuinely surfaced
one — this job is about a single card.

## Do not

- Do not create, edit or delete anything under `vault/`.
- Do not propose other cards. One card in, one card out.
- Do not invent a technology, a deadline, or a stakeholder the brief does not mention.

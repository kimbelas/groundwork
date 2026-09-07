---
description: One iteration of the workflow-v1-1 plan — next task in the foreground, e2e batch in the background
---

Work one iteration of the plan of record at `.claude/plans/workflow-v1-1.md`. Designed to
be driven by `/loop /workflow-v1-1` (self-paced); a single manual invocation does exactly
one iteration.

Each iteration, in order:

1. **Collect.** If a background e2e batch finished since last iteration, read its result
   now — from its output file, never through `head` or `tail`, because a pipeline exits
   with the last command's status and that has already put out a commit claiming "lint
   clean" when it was not. Update the batch table in the plan file. Triage per the plan's
   protocol: background failures are advisory leads on this 4-core box, a single cold
   compile timeout is re-run before it is believed, and a warmup failure means ~180 tests
   never ran while the summary says `1 failed`. If a failure survives a quiet re-run of
   that spec alone, it becomes this iteration's task — a regression outranks the next
   feature box.

2. **Launch.** If no batch is running, start the next not-yet-green batch from the table
   with `run_in_background`, but only if the code it exercises is stable right now — never
   run batch 1 mid-rewrite of the AI layer; it can only report noise. One batch at a time,
   ever: they share port 4849 and `.next-e2e`. If a previous batch was killed, clean up
   first — `taskkill /PID <pid> /F` on the 4849 listener, then remove `.next-e2e`.

3. **Implement.** Take the first unchecked `[ ]` task and do it fully, under every
   CLAUDE.md invariant, giving particular weight to the one named on the task's own
   **Risk:** line. If it is blocked, write why next to it and take the next one. Never
   narrow a task silently — split it into sub-boxes so the remainder stays visible.

   During Phase W the "implementation" is the walk itself: drive the isolated instance on
   port 4850 (scratch vault, fixture engine — see the plan's protocol section), screenshot
   every step, and **look at the screenshots**. A blank frame is a failure to launch, not
   a pass. Findings go in the plan file, ranked, never only in scrollback.

4. **Verify.** Run the task's own *Verify* line: targeted `pnpm test <file>` in the
   foreground, plus lint, typecheck and both gates when the task touched what they cover.
   After changes to `lib/`, `app/` or `components/`, run the `invariant-guard` agent on the
   diff. At a phase boundary, run `phase-warden` before checking the last box of the phase.

5. **Record.** Check the box with a one-line result note saying what actually happened —
   including any deviation from what the box asked for. Append one line to the plan's
   Iteration log. Commit coherent units, subject in the style of the existing history, no
   Co-Authored-By line. A doc or guardrail that describes changed behaviour changes in the
   same commit as the behaviour.

6. **Pace or stop.** If tasks remain, schedule the next iteration to fit the work in
   flight (a running e2e batch is a couple of minutes; otherwise proceed promptly). When
   every box including E1 and E2 is checked and green, update the plan file's status,
   report what shipped, and **stop the loop** — do not idle.

Ground rules the plan states in full and this command must not override: the run scope
guard (`assertInstructionScoped`) is never weakened; the apply route re-reads the proposal
from disk and the browser never says what a block contains; background e2e greens do not
count for sign-off, because E1 re-runs everything quiet; and the walkthrough instance never
points at the user's real `vault/`.

---
description: One iteration of the finish-v1 plan — next task in the foreground, e2e batch in the background
---

Work one iteration of the plan of record at `.claude/plans/finish-v1.md`. Designed to be
driven by `/loop /finish-v1` (self-paced); a single manual invocation does exactly one
iteration.

Each iteration, in order:

1. **Collect.** If a background e2e batch finished since last iteration, read its result
   now. Update the batch table in the plan file. Triage per the plan's protocol:
   background failures are advisory leads on this 4-core box, a single cold-compile
   timeout is re-run before it is believed, a warmup failure means ~180 tests never ran.
   If a batch failure survives a quiet re-run of that spec, it becomes the iteration's
   task — fixing a regression outranks the next feature box.

2. **Launch.** If no batch is running, start the next not-yet-green batch from the table
   with `run_in_background` — but only if the code it exercises is stable right now
   (never run batch 1 mid-rewrite of the AI layer; it can only report noise). One batch
   at a time, ever: they share port 4849 and `.next-e2e`. If a previous batch was
   killed, clean up first: `taskkill /PID <pid> /F` on the 4849 listener, then remove
   `.next-e2e`.

3. **Implement.** Take the first unchecked `[ ]` task in the plan file and do it fully,
   under every CLAUDE.md invariant. If it is blocked, write why next to it and take the
   next one. Never narrow a task silently — split it into sub-boxes so the remainder
   stays visible.

4. **Verify.** Run the task's own *Verify* line: targeted `pnpm test <file>` in the
   foreground, plus lint/typecheck/gates when the task touched what they cover. After
   changes to `lib/`, `app/` or `components/`, run the `invariant-guard` agent on the
   diff. At a phase gate task, run `phase-warden` before checking the box.

5. **Record.** Check the box with a one-line result note, append one line to the plan's
   Iteration log, and commit when a coherent unit is done — subject in the style of the
   existing history, no Co-Authored-By line.

6. **Pace or stop.** If tasks remain, schedule the next iteration to fit the work in
   flight (a running e2e batch is ~2 min; otherwise proceed promptly). When every box
   including the final gate (T13) is checked and green, update the plan file's status,
   report what shipped, and **stop the loop** — do not idle.

Ground rules the plan file states in full and this command must not override: the run
scope guard (`assertInstructionScoped`) is never weakened; background e2e greens do not
count for sign-off — T13 re-runs everything quiet; docs and guardrails change in the
same commit as the behaviour they describe.

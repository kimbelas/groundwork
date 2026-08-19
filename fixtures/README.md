# Probe fixtures

`prompts/*.md` is product surface with no type system and no test suite. An edit to `synthesize.md` that fixes one behaviour will quietly degrade another, and nothing in the app will tell you.

These probes are the cheap guard. Each brief in `briefs/` is written to bait one specific failure mode, and carries an `## Expectations` section stating what a good run does with it.

## Using them

1. Create a scratch project in the vault with the archetype the probe names.
2. Paste the brief text — everything above the `## Expectations` rule — into its Brief.
3. Run Synthesize.
4. Read the proposal against the expectations. Do not skim: the failures these catch look plausible.
5. Delete the scratch project.

Run all three after any edit to `prompts/synthesize.md`. Run the relevant one after a targeted change.

## Judging

The expectations are prose, not assertions, because the thing being judged is prose. Resist turning them into a score — a run that satisfies every bullet and still reads like a template has failed, and a run that misses a bullet for a defensible reason has not.

Two failures outrank all the others, because they are the ones the product exists to prevent:

- **Invention.** A card asserting something the brief never said, especially with a `groundedIn` quote that does not appear verbatim in the brief. The validator catches non-matching quotes; it cannot catch a real quote stretched to justify an unrelated card.
- **Confident vagueness.** An empty or near-empty questions array on a brief that is genuinely underspecified. The model smoothing over a gap instead of naming it is worse than a thin plan.

## Later

Phase 5 adds `/eval-prompts`, which runs these automatically and diffs each run against the stored previous one. It automates the *diffing*, not the judging — that part stays manual on purpose.

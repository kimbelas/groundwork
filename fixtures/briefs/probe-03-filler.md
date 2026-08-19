# Probe 03 — Filler bait

**Archetype:** `saas-mvp`
**Baits:** generic lifecycle phases and unfalsifiable acceptance criteria.

---

Small SaaS for freelance translators. They juggle jobs from several agencies, each with
its own rate card and its own idea of what a "word" is, and they lose money because they
can't tell which agency is actually worth working for.

Core thing: log a job, and have it tell you your real effective hourly rate on it once
it's done. Then rank the agencies by that.

Solo product, I'll build it nights and weekends. Needs to be worth paying for within six
months or I drop it.

---

## Expectations

This brief is unusually clear, so the failure mode here is not invention — it is a plan made of scaffolding. The output should be sharply domain-specific.

**No generic lifecycle phases.** Setup, Design, Development, Testing, Deployment, Launch, Maintenance — none of these belong. Phases here are about the actual problem: nailing the rate-card model, getting one honest end-to-end calculation, then the agency comparison that is the whole point.

**Testing is acceptance criteria, not a phase.** "The effective-rate calculation is correct for a per-word job, a per-hour job, and a minimum-charge job" is a criterion. A "Testing" phase is the model deferring the definition of correctness.

**Criteria must be capable of failing.** "Works correctly", "is user friendly", "is performant", "has good test coverage" are all unfalsifiable. Compare against: "two agencies with different word-count definitions on the same source text produce different effective rates, and the difference is explained on screen."

**The rate-card variance is the hard part and should be treated as such.** Each agency having its own definition of a word is the technical core of the product. If it is one card of equal weight to "build the job log", the model has not understood which part is difficult.

**The six-month kill criterion is real and should survive.** It belongs in the risk or assumption register. Dropping it loses the most decision-relevant sentence in the brief.

### Specific failures to watch for

- Cards for onboarding, marketing site, pricing page, or billing. It is a solo nights-and-weekends MVP with an explicit kill date; scope creep is the main threat to it existing at all.
- Team, collaboration, or multi-user features. It says solo, twice over.
- Uniform sizes and confidence across every card. Real plans are lumpy. Everything at M/0.7 means the model filled the fields instead of judging them.
- A phase count that matches the number of phases in the last probe you ran. Structural sameness across unrelated briefs is the clearest sign a template is doing the work.

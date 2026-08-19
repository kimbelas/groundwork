# Probe 01 — Underspecified

**Archetype:** `internal-tool`
**Baits:** confident vagueness — filling gaps with plausible invention instead of asking.

---

Internal tool for the ops team. They do it in a spreadsheet right now and it breaks
constantly, usually around month end when everyone's in it at once.

Needs to handle the monthly cycle properly. Should probably have some kind of approval
step before things go out.

Would be good to have it before Q4.

---

## Expectations

**Must ask, not assume.** The brief never says what "it" is. A good run produces at least four open questions covering: what the spreadsheet actually tracks, what "breaks" means (data loss, lock contention, formula errors — these imply completely different builds), who approves what and against which criteria, and what "the monthly cycle" consists of.

**Must not invent a domain.** There is nothing here indicating finance, scheduling, inventory, or payroll. A proposal naming any of those has failed, however reasonable the guess. The same goes for a tech stack — nothing in the brief implies one.

**`groundedIn: null` is the honest answer for most cards here** and should appear that way. A run that manufactures a verbatim quote for every card is stretching the brief's few concrete phrases past what they support. The two genuinely grounded facts are the concurrency symptom at month end and the approval step.

**Cards should be thin and few.** Perhaps: capture what the spreadsheet does today, reproduce the month-end concurrency failure, define the approval rule. Anything past that is speculation dressed as planning.

**Q4 is a constraint, not a phase.** It belongs in a risk or an assumption — "before Q4" with no start date and no scope is an assumption that needs validating, not a deadline to plan against.

### Specific failures to watch for

- A "Requirements gathering" phase. That is the model noticing it lacks information and scheduling the problem instead of asking. The Open Questions queue exists precisely so this never has to happen.
- Cards for authentication, audit logging, notifications, or reporting. None are mentioned. All are what a template supplies when the brief runs out.
- High confidence values. Nothing here is well understood; scores above ~0.4 are miscalibrated.

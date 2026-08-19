# Probe 02 — Vocabulary and grounding

**Archetype:** `client`
**Baits:** silent vocabulary substitution, and expanding a passing mention into a confident feature.

---

Property manager wants the tenant portal replaced. Right now tenants call the office to
report anything, and the office keys it into the work order system by hand.

Tenants should be able to raise a work order themselves against their unit, see where it
is, and get told when it's done. Units are grouped into buildings, and a building has one
assigned super who picks up the work orders for it.

They mentioned something about wanting to handle renewals in there too eventually.

The work order system is a 2014 on-prem thing with a SOAP endpoint. It is not going away.

---

## Expectations

**Vocabulary is preserved exactly.** The domain words are *tenant*, *unit*, *building*, *super*, *work order*. A proposal that says customer, property, resident, manager, maintenance request, or ticket has silently rewritten the client's language — the single fastest way for a plan to stop being about their business. This is the primary thing this probe tests.

**The renewals line becomes a question, not a card.** "Mentioned something about wanting to handle renewals eventually" is the brief explicitly flagging vagueness and non-urgency. Any card for renewals is invention. A good run asks what renewals involves and whether it is in scope at all.

**The SOAP constraint is load-bearing.** "Not going away" is the hardest fact in the brief. It should appear as a risk or drive an integration card, and it should be quoted verbatim in a `groundedIn`. A proposal that plans a greenfield work order system has ignored the one thing the client was unambiguous about.

**Grounding quotes must be real.** Check two or three `groundedIn` values character-by-character against the brief text. Near-quotes — right idea, reworded — mean the model is paraphrasing into a field whose entire purpose is to be verbatim, and the validator's string match should already have flagged them. If it did not, the validator is broken.

### Specific failures to watch for

- A card for tenant login or account management. Not mentioned. Plausible, still invented — and it should surface as a question about how tenants are identified, since the brief genuinely doesn't say.
- The super's assignment logic treated as trivial. The brief says one super per building, but says nothing about coverage when they're away, which is a real question.
- Push notifications. "Get told when it's done" does not specify a channel. That is a question; the client may well mean the phone calls they already make.
- Any phase named "Integration". The SOAP work is specific enough to name for what it is.

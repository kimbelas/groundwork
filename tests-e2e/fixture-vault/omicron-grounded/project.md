---
name: Omicron Grounded
slug: omicron-grounded
stage: building
health: green
archetype: internal-tool
columns: [Intake, Shaping, Done]
created: 2026-08-21
updated: 2026-08-21
---

Two people editing the same card overwrite each other. Every write should carry the
mtime it loaded so a stale one is refused.

## What we know

The ordering arithmetic lives on the server and uses sparse integers.

## What we don't

Whether a refused write should retry by itself or ask the person.

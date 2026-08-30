---
name: Sigma Deletable
slug: sigma-deletable
stage: shaping
health: green
archetype: internal-tool
columns: [Intake, Build, Done]
created: 2026-08-20
updated: 2026-08-20
---

The delete spec's own project, per CLAUDE.md. delete-project.spec.ts removes this folder
and rebuilds it before every test; nothing else may read or reset it.

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Chip } from "@/components/ui/Chip";
import { healthTone, stageTone } from "@/lib/format";
import { archetypeLabel, healthLabel, stageLabel } from "@/lib/labels";
import { ARCHETYPES, HEALTHS, STAGES } from "@/lib/schema";
import type { ProjectMeta } from "@/lib/schema";

import { useProjectDoc } from "./ProjectDoc";

/**
 * Stage, health and archetype. Writes frontmatter only, and never the body.
 *
 * Stage and health are human judgments — nothing in the AI layer may set them, which is
 * why they are edited here and nowhere else.
 */
export function MetaBar({ meta }: { meta: ProjectMeta }) {
  const doc = useProjectDoc();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [local, setLocal] = useState({
    stage: meta.stage,
    health: meta.health,
    archetype: meta.archetype,
  });
  const [error, setError] = useState<string | null>(null);

  async function apply<K extends keyof typeof local>(key: K, next: (typeof local)[K]) {
    const previous = local[key];
    setLocal((s) => ({ ...s, [key]: next }));
    setError(null);

    try {
      await doc.writeMeta({ [key]: next });
      // Refresh so the dashboard, rail and any derived counts pick the change up.
      startTransition(() => router.refresh());
    } catch (e) {
      setLocal((s) => ({ ...s, [key]: previous }));
      setError((e as Error).message);
    }
  }

  return (
    <div className="metabar" data-testid="meta-bar">
      <label className="metabar-field">
        <span className="label">Stage</span>
        <select
          className="select"
          value={local.stage}
          disabled={doc.conflicted}
          onChange={(e) => void apply("stage", e.target.value as ProjectMeta["stage"])}
          aria-label="Stage"
        >
          {/* Value stays the stored code; only the text is a word. */}
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {stageLabel(s)}
            </option>
          ))}
        </select>
        <Chip tone={stageTone(local.stage)}>{stageLabel(local.stage)}</Chip>
      </label>

      <label className="metabar-field">
        <span className="label">Health</span>
        <select
          className="select"
          value={local.health}
          disabled={doc.conflicted}
          onChange={(e) => void apply("health", e.target.value as ProjectMeta["health"])}
          aria-label="Health"
        >
          {HEALTHS.map((h) => (
            <option key={h} value={h}>
              {healthLabel(h)}
            </option>
          ))}
        </select>
        <Chip tone={healthTone(local.health)}>{healthLabel(local.health)}</Chip>
      </label>

      <label className="metabar-field">
        <span className="label">Archetype</span>
        <select
          className="select"
          value={local.archetype}
          disabled={doc.conflicted}
          onChange={(e) => void apply("archetype", e.target.value as ProjectMeta["archetype"])}
          aria-label="Archetype"
        >
          {ARCHETYPES.map((a) => (
            <option key={a} value={a}>
              {archetypeLabel(a)}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <span className="mono" style={{ color: "var(--s-blocked)" }} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";
import { healthTone, stageTone } from "@/lib/format";
import { archetypeLabel, healthLabel, stageLabel } from "@/lib/labels";
import { resolveOptimistic, type Optimistic } from "@/lib/optimistic";
import { ARCHETYPES, HEALTHS, STAGES } from "@/lib/schema";
import type { ProjectMeta } from "@/lib/schema";

import { useProjectDoc } from "./ProjectDoc";

/** The three fields this bar owns. Everything else in the frontmatter is written elsewhere. */
type Editable = Pick<ProjectMeta, "stage" | "health" | "archetype">;

/**
 * An optimistic value per field, each remembering what it was written over.
 *
 * The expiry rule lives in `lib/optimistic.ts` with its own tests, because the subtle part
 * is not "show the local value" — it is knowing when to stop.
 */
type Pending = { [K in keyof Editable]?: Optimistic<Editable[K]> };

/**
 * Stage, health and archetype. Writes frontmatter only, and never the body.
 *
 * Stage and health are human judgments — nothing in the AI layer may set them, which is
 * why they are edited here and nowhere else.
 *
 * This used to copy `meta` into `useState` at mount. `useState` ignores a changed initial
 * value, so the bar froze at first render: a `router.refresh()` that brought a new stage —
 * from an Obsidian edit, another tab, or an applied proposal — reached the page title, the
 * rail and the dashboard, and never reached these three controls. The screen showed two
 * different answers for the same field, and the next edit from here wrote over the newer
 * one with a stale precondition, which 409s and latches the whole document read-only.
 *
 * So the server is the source of truth and this holds only unconfirmed overrides, which is
 * the pattern `components/board/Board.tsx` already uses and `CLAUDE.md` requires.
 */
export function MetaBar({ meta }: { meta: ProjectMeta }) {
  const doc = useProjectDoc();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [pending, setPending] = useState<Pending>({});
  const [error, setError] = useState<string | null>(null);

  /** The value to render. The expiry rule is in lib/optimistic.ts, tested separately. */
  function shown<K extends keyof Editable>(key: K): Editable[K] {
    return resolveOptimistic(meta[key], pending[key]);
  }

  const drop = <K extends keyof Editable>(key: K) =>
    setPending((p) => {
      const { [key]: _dropped, ...rest } = p;
      return rest as Pending;
    });

  async function apply<K extends keyof Editable>(key: K, next: Editable[K]) {
    setPending((p) => ({ ...p, [key]: { value: next, base: meta[key] } }));
    setError(null);

    try {
      await doc.writeMeta({ [key]: next });

      /**
       * Retire the override and refresh in the same transition.
       *
       * An override that outlives its write is not harmless. The rule compares the server
       * against what the value was written *over*, so a spent entry reactivates the moment
       * the server returns to that base — set a stage here, then set it back in Obsidian,
       * and the control confidently shows the value you picked while the file says
       * otherwise. That is the failure `lib/optimistic.ts` exists to prevent, reached from
       * the other side.
       *
       * Both updates go inside the transition so they commit together: React holds the old
       * UI until the refresh resolves, so the control never flashes back to the previous
       * value in the gap between clearing and the new data arriving. Clearing it in an
       * effect keyed on "nothing in flight" would work too, and `react-hooks` rejects it —
       * correctly, since that is the cascading-render pattern this codebase already bans.
       */
      startTransition(() => {
        drop(key);
        router.refresh();
      });
    } catch (e) {
      // Drop the override rather than reverting to a remembered value: whatever the server
      // holds now is the truth, and it may not be what was there when this started.
      drop(key);
      setError((e as Error).message);
    }
  }

  const stage = shown("stage");
  const health = shown("health");
  const archetype = shown("archetype");

  return (
    <div className="metabar" data-testid="meta-bar">
      <label className="metabar-field">
        <span className="label">Stage</span>
        <select
          className="select"
          value={stage}
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
        <Chip tone={stageTone(stage)}>{stageLabel(stage)}</Chip>
      </label>

      <label className="metabar-field">
        <span className="label">Health</span>
        <select
          className="select"
          value={health}
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
        <Chip tone={healthTone(health)}>{healthLabel(health)}</Chip>
      </label>

      <label className="metabar-field">
        <span className="label">Archetype</span>
        <select
          className="select"
          value={archetype}
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

      {error && <Notice className="metabar-error">{error}</Notice>}
    </div>
  );
}

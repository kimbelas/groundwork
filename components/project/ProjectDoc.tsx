"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import type { ARCHETYPES, HEALTHS, STAGES } from "@/lib/schema";

export interface MetaPatch {
  name?: string;
  stage?: (typeof STAGES)[number];
  health?: (typeof HEALTHS)[number];
  archetype?: (typeof ARCHETYPES)[number];
  columns?: string[];
  /**
   * An absolute path to connect, or `null` to disconnect.
   *
   * `null` rather than omitting the key, because omitting it means "leave it alone" and
   * there has to be a way to say "remove it". The server resolves the path it is given
   * and stores the canonical form, so what comes back may not be the string sent.
   */
  repo?: string | null;
}

interface ProjectDocValue {
  slug: string;
  conflicted: boolean;
  writeBrief: (body: string) => Promise<void>;
  writeMeta: (patch: MetaPatch) => Promise<void>;
}

const Ctx = createContext<ProjectDocValue | null>(null);

/**
 * Owns the single write baseline for `project.md`.
 *
 * The brief editor and the metadata bar both write that one file. If each kept its own
 * mtime, a metadata change would invalidate the editor's baseline and the user's next
 * keystroke would 409 through no fault of theirs. So the baseline lives here, and every
 * write goes through one promise chain:
 *
 *  - **Serialised.** Two writes can never be in flight against the same file, so the
 *    mtime a request carries is always the one the previous write produced.
 *  - **Shared conflict lock.** A genuine outside change (Obsidian, an AI apply) locks
 *    both writers at once. Retrying with a refreshed mtime would clobber exactly what
 *    the precondition is there to protect.
 */
export function ProjectDocProvider({
  slug,
  initialMtimeMs,
  children,
}: {
  slug: string;
  initialMtimeMs: number;
  children: React.ReactNode;
}) {
  const mtimeRef = useRef(initialMtimeMs);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const conflictedRef = useRef(false);
  const [conflicted, setConflicted] = useState(false);

  const send = useCallback(
    (payload: Record<string, unknown>): Promise<void> => {
      const task = chainRef.current.then(async () => {
        if (conflictedRef.current) {
          throw Object.assign(new Error("This file changed on disk."), { code: "conflict" });
        }

        const res = await fetch(`/api/vault/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, expectedMtimeMs: mtimeRef.current }),
        });

        const data: unknown = await res.json().catch(() => null);

        if (!res.ok) {
          const detail = (data ?? {}) as { error?: string; code?: string };
          if (detail.code === "conflict") {
            conflictedRef.current = true;
            setConflicted(true);
          }
          throw Object.assign(new Error(detail.error ?? `Save failed (${res.status})`), {
            code: detail.code,
          });
        }

        const ok = data as { mtimeMs?: number } | null;
        if (typeof ok?.mtimeMs === "number") mtimeRef.current = ok.mtimeMs;
      });

      // Keep the chain alive after a rejection, but let the caller see the error.
      chainRef.current = task.catch(() => undefined);
      return task;
    },
    [slug],
  );

  const value = useMemo<ProjectDocValue>(
    () => ({
      slug,
      conflicted,
      writeBrief: (body) => send({ kind: "brief", body }),
      writeMeta: (patch) => send({ kind: "meta", patch }),
    }),
    [slug, conflicted, send],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjectDoc(): ProjectDocValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProjectDoc must be used inside ProjectDocProvider");
  return ctx;
}

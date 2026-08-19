"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { Chip } from "@/components/ui/Chip";
import { likelihoodLabel } from "@/lib/labels";
import type { Assumption, Risk } from "@/lib/schema";

const IMPACT_TONE = { low: "paused", med: "idea", high: "blocked" } as const;

/**
 * Risks and assumptions.
 *
 * An unvalidated assumption renders visibly differently from a validated one, because
 * the entire purpose of the register is to make "we are proceeding as though this were
 * true" impossible to overlook.
 */
export function RiskRegister({
  slug,
  risks,
  assumptions,
  initialMtimeMs,
}: {
  slug: string;
  risks: Risk[];
  assumptions: Assumption[];
  initialMtimeMs: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Server data stays the source of truth; this holds only unconfirmed toggles.
   * Copying `assumptions` into state would freeze the list at first render, so an AI
   * apply that added an assumption would never appear without a full reload.
   */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());

  const live = useMemo(() => {
    if (overrides.size === 0) return overrides;
    const next = new Map(overrides);
    for (const [id, validated] of overrides) {
      const server = assumptions.find((a) => a.id === id);
      if (!server || server.validated === validated) next.delete(id);
    }
    return next;
  }, [overrides, assumptions]);

  const local = useMemo(
    () => assumptions.map((a) => ({ ...a, validated: live.get(a.id) ?? a.validated })),
    [assumptions, live],
  );

  const clearOverride = useCallback((id: string) => {
    setOverrides((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // One shared baseline for risks.md, advanced by each write.
  const mtimeRef = useRef(initialMtimeMs);

  async function toggle(id: string, validated: boolean) {
    setOverrides((prev) => new Map(prev).set(id, validated));
    setBusy(id);
    setError(null);

    try {
      const res = await fetch("/api/risks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, id, validated, expectedMtimeMs: mtimeRef.current }),
      });

      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (payload ?? {}) as { error?: string };
        throw new Error(detail.error ?? `Could not save (${res.status})`);
      }

      mtimeRef.current = (payload as { mtimeMs: number }).mtimeMs;
      // The override is dropped by the derivation above once the refresh lands.
      router.refresh();
    } catch (e) {
      clearOverride(id);
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const unvalidated = local.filter((a) => !a.validated).length;

  return (
    <section className="stack" style={{ gap: 16 }} data-testid="risk-register">
      {error && (
        <div className="notice body-sm" role="alert" data-testid="risks-error">
          {error}
        </div>
      )}

      <div>
        <span className="label">Risks ({risks.length})</span>
        {risks.length === 0 ? (
          <p className="body-sm faint">None recorded. Critique proposes them.</p>
        ) : (
          <ul className="register">
            {risks.map((r) => (
              <li key={r.id} className="register-item" data-testid={`risk-${r.id}`}>
                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                  <Chip tone={IMPACT_TONE[r.impact]}>
                    {likelihoodLabel(r.likelihood)} / {likelihoodLabel(r.impact)}
                  </Chip>
                  <span>{r.text}</span>
                </div>
                {r.mitigation && (
                  <p className="body-sm soft" style={{ margin: "5px 0 0" }}>
                    <span className="mono faint">mitigation </span>
                    {r.mitigation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <span className="label">
          Assumptions ({local.length}
          {unvalidated > 0 ? `, ${unvalidated} unvalidated` : ""})
        </span>
        {local.length === 0 ? (
          <p className="body-sm faint">None recorded.</p>
        ) : (
          <ul className="register">
            {local.map((a) => (
              <li
                key={a.id}
                className="register-item"
                data-testid={`assumption-${a.id}`}
                data-validated={a.validated ? "true" : "false"}
              >
                <label className="proposal-row">
                  <input
                    type="checkbox"
                    checked={a.validated}
                    disabled={busy === a.id}
                    aria-label={`Validated: ${a.text}`}
                    onChange={(e) => void toggle(a.id, e.target.checked)}
                  />
                  <span>
                    {a.text}{" "}
                    {a.validated ? (
                      <Chip tone="done">validated</Chip>
                    ) : (
                      <Chip tone="idea" hollow>
                        unvalidated
                      </Chip>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Undo the newest AI apply.
 *
 * Availability is read from the server rather than inferred from what this tab happens
 * to have done — an apply from another tab, or from before a reload, is just as
 * revertible.
 */
export function RevertButton({ slug, nonce }: { slug: string; nonce: number }) {
  const router = useRouter();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/ai/revert?slug=${encodeURIComponent(slug)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { available: boolean };
        if (!cancelled) setAvailable(data.available);
      } catch {
        /* leave the control hidden if we cannot tell */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, nonce]);

  // Only the control is conditional. A successful revert clears availability, so
  // returning null here would swallow the very message that says it worked.
  if (!available && !message) return null;

  async function revert() {
    if (!window.confirm("Undo the last AI change? Files it created move to the trash folder.")) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/revert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (payload ?? {}) as { error?: string };
        throw new Error(detail.error ?? `Revert failed (${res.status})`);
      }

      const result = payload as { restored: number; trashed: number };
      setMessage(`Restored ${result.restored} file(s), trashed ${result.trashed}.`);
      setAvailable(false);
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {available && (
        <button
          type="button"
          className="link-button mono"
          disabled={busy}
          onClick={() => void revert()}
          data-testid="revert"
        >
          {busy ? "reverting..." : "revert last AI change"}
        </button>
      )}
      {message && (
        <span className="mono faint" data-testid="revert-result">
          {message}
        </span>
      )}
    </>
  );
}

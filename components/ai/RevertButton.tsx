"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * Undo the newest AI apply.
 *
 * Availability is read from the server rather than inferred from what this tab happens
 * to have done — an apply from another tab, or from before a reload, is just as
 * revertible.
 *
 * The confirmation is a modal, not a drawer: it is a decision with two answers about
 * something that moves files, and there is nothing behind it worth reading while you
 * answer. It replaced a `window.confirm`, which said one unstyled line and could not
 * mention the part that actually matters: a revert overwrites anything you edited yourself
 * since the apply.
 */
export function RevertButton({ slug, nonce }: { slug: string; nonce: number }) {
  const router = useRouter();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
    setConfirming(false);
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
        <Button
          variant="quiet"
          danger
          disabled={busy}
          onClick={() => setConfirming(true)}
          data-testid="revert"
        >
          {busy ? "Reverting…" : "Revert last AI change"}
        </Button>
      )}

      {confirming && (
        <ConfirmDialog
          title="Undo the last AI change?"
          body={
            <>
              Files the apply changed are restored from their snapshot, and files it created
              move to the project&rsquo;s <code>.trash</code> folder. Anything you edited
              yourself since then is overwritten by the snapshot.
            </>
          }
          confirmLabel="Undo it"
          danger
          busy={busy}
          onConfirm={() => void revert()}
          onCancel={() => setConfirming(false)}
          testId="confirm-revert"
        />
      )}
      {message && (
        <span className="mono faint" data-testid="revert-result">
          {message}
        </span>
      )}
    </>
  );
}

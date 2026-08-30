"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

import { DeleteProjectDialog } from "./DeleteProjectDialog";

/**
 * Delete, from the dashboard row.
 *
 * ## Why this holds its own baseline
 *
 * `CLAUDE.md` routes every writer of one file through `ProjectDocProvider` so they share an
 * mtime. That rule exists because the brief editor and the meta bar write the same
 * `project.md` concurrently. Nothing on the dashboard writes anything, so there is no second
 * writer to share with - and the baseline it needs is not one this component could fetch
 * for itself anyway. It is rendered in, from the same server read that produced the row.
 *
 * That is what makes the precondition mean something here. Re-reading the mtime when the
 * button is clicked would guard the microseconds between the read and the request; taking it
 * from the render guards the whole time the page has been sitting open, which is the window
 * where an Obsidian save or an AI apply actually happens.
 *
 * ## Why both outcomes are toasts
 *
 * The row is gone on success and the page is a server component, so there is nowhere inline
 * left to report to. On failure the row survives, but a `Notice` inside a table cell either
 * breaks the column widths or hides at 390px where the table is a stack of cards. An error
 * toast persists until dismissed, which is the same guarantee an inline notice would give.
 */
export function DeleteProjectRow({
  slug,
  name,
  mtimeMs,
}: {
  slug: string;
  name: string;
  mtimeMs: number;
}) {
  const router = useRouter();
  const toast = useToast();

  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);

    try {
      const res = await fetch(`/api/vault/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedMtimeMs: mtimeMs }),
      });

      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (data ?? {}) as { error?: string };
        throw new Error(detail.error ?? `Delete failed (${res.status})`);
      }

      toast.success(`Deleted "${name}" - moved to the vault's trash`);
      setAsking(false);
      router.refresh();
    } catch (e) {
      setAsking(false);
      toast.error(`Could not delete "${name}": ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="quiet"
        danger
        onClick={() => setAsking(true)}
        /*
         * Named, not just "Delete". Every row has one of these, so the bare word leaves a
         * screen-reader user with a list of identical buttons and no way to tell which
         * project each one removes.
         */
        aria-label={`Delete ${name}`}
        data-testid={`delete-row-${slug}`}
      >
        Delete
      </Button>

      {asking && (
        <DeleteProjectDialog
          name={name}
          busy={busy}
          testId="delete-project-confirm"
          onCancel={() => setAsking(false)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}

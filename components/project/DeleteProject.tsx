"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { useToast } from "@/components/ui/Toast";

import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { useProjectDoc } from "./ProjectDoc";

/**
 * Remove a project.
 *
 * ## Dialog, not drawer
 *
 * There is nothing to work on here, only something to decide, so this is a `ConfirmDialog`
 * and not a `Drawer` - it blocks, traps focus, and can name what it is about to do. The
 * naming is the part that matters: a project is deleted by the person who has been living
 * in it, and the only question worth asking is whether the plan is recoverable afterwards.
 * It is, and the dialog says where it goes, because a destructive prompt that cannot
 * explain itself is one people learn to click through.
 *
 * ## Why it reports through a toast
 *
 * On success this page stops existing - the project it renders is gone and the route
 * redirects to the dashboard. That is the case `CLAUDE.md` warns about: *"A UI component
 * must not unmount itself before reporting what it did."* Keeping the panel open is not
 * available as a fix when the panel's own project has been removed, so the confirmation
 * outlives the surface as a toast.
 *
 * A *failure* is the opposite: the project is still there, so the message belongs inline
 * where the user is already looking, and the dialog closes so the error is not behind it.
 */
export function DeleteProject({ name }: { name: string }) {
  const { trash, conflicted } = useProjectDoc();
  const router = useRouter();
  const toast = useToast();

  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);

    try {
      await trash();
      /*
       * Raised before navigating, not after.
       *
       * The toast layer lives in the root layout, so it survives the route change - but
       * this component does not, and a `raise` scheduled after `router.replace` would be
       * running in a component React has already torn down.
       */
      toast.success(`Deleted "${name}" - moved to the vault's trash`);
      router.replace("/");
      router.refresh();
    } catch (e) {
      // Close the question, keep the panel. The error has to be readable, and it is not
      // readable underneath a modal that is still asking whether to do the thing.
      setAsking(false);
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="danger-panel" data-testid="delete-project">
      <div className="row danger-head">
        <p className="label">Delete project</p>
        <Button
          danger
          disabled={conflicted}
          onClick={() => setAsking(true)}
          data-testid="delete-project-open"
        >
          Delete
        </Button>
      </div>

      <p className="body-sm soft danger-blurb">
        Moves the whole project folder into the vault&rsquo;s trash. It leaves the rail and
        the dashboard, and nothing is erased &mdash; the files stay on disk under{" "}
        <span className="mono">.trash</span> until you remove them yourself.
      </p>

      {conflicted && (
        <Notice data-testid="delete-project-conflict">
          This project changed on disk since the page loaded. Reload before deleting, so
          you are deleting what you think you are.
        </Notice>
      )}

      {error && <Notice data-testid="delete-project-error">{error}</Notice>}

      {asking && (
        <DeleteProjectDialog
          name={name}
          busy={busy}
          testId="delete-project-confirm"
          onCancel={() => setAsking(false)}
          onConfirm={() => void remove()}
        />
      )}
    </section>
  );
}

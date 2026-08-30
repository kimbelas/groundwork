"use client";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * The question asked before a project is removed, in one place.
 *
 * Two surfaces ask it - the panel at the foot of the Brief and the row action on the
 * dashboard - and the wording is the load-bearing part of a destructive prompt. Two copies
 * of it is two copies that drift, and the half that would drift is the promise that nothing
 * is erased, which is the only reason this is safe to click.
 */
export function DeleteProjectDialog({
  name,
  busy,
  onConfirm,
  onCancel,
  testId,
}: {
  name: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId: string;
}) {
  return (
    <ConfirmDialog
      danger
      busy={busy}
      testId={testId}
      title={`Delete "${name}"?`}
      confirmLabel="Delete project"
      onCancel={onCancel}
      onConfirm={onConfirm}
      body={
        <>
          <p>
            The brief, the board, every card, the decision log and the question list all move
            together into <span className="mono">.trash</span> inside your vault.
          </p>
          <p>
            Nothing is erased. To get the project back, move that folder out of{" "}
            <span className="mono">.trash</span> and rename it to its slug.
          </p>
        </>
      }
    />
  );
}

"use client";

import type { SaveStatus } from "./useAutosave";

const LABEL: Record<SaveStatus, string> = {
  clean: "",
  dirty: "Unsaved",
  saving: "Saving...",
  saved: "Saved",
  conflict: "Changed on disk",
  error: "Save failed",
};

function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Save state is always visible. An editor that autosaves without saying so is an
 * editor you cannot trust with the only copy of something.
 */
export function SaveState({ status, savedAt }: { status: SaveStatus; savedAt: number | null }) {
  if (status === "clean") return null;

  const text =
    status === "saved" && savedAt ? `${LABEL.saved} ${clockTime(savedAt)}` : LABEL[status];

  return (
    <span
      className="mono"
      data-testid="save-state"
      data-status={status}
      role="status"
      aria-live="polite"
      style={{
        color:
          status === "conflict" || status === "error" ? "var(--s-blocked)" : "var(--ink-faint)",
      }}
    >
      {text}
    </span>
  );
}

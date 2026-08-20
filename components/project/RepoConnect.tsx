"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";

import { useProjectDoc } from "./ProjectDoc";

/**
 * Connect or disconnect the repository a project plans against.
 *
 * Writes `project.md` through `ProjectDocProvider`, which is not optional: the brief
 * editor and the meta bar write that same file, and a second baseline here would make a
 * repo change 409 the user's next keystroke.
 *
 * Holds no optimistic override, unlike `MetaBar`. The server canonicalises the path — it
 * resolves symlinks and normalises separators — so what comes back is frequently not what
 * was typed, and showing the typed value while the write is in flight would mean the
 * field visibly corrects itself a moment later. A pending state is honest here and the
 * round trip is one file write.
 */
export function RepoConnect({ connected }: { connected: string | null }) {
  const doc = useProjectDoc();
  const router = useRouter();
  const [saving, startTransition] = useTransition();

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  async function send(repo: string | null) {
    setBusy(true);
    setError(null);
    try {
      await doc.writeMeta({ repo });
      setDraft("");
      // The panel above reads the repo from the server, so a refresh is what makes the
      // change visible. Nothing local mirrors it, which is why there is nothing to clear.
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pending = busy || saving;

  if (connected) {
    return (
      <div className="repo-actions">
        <Button danger disabled={pending || doc.conflicted} onClick={() => void send(null)}>
          {pending ? "Disconnecting…" : "Disconnect"}
        </Button>
        {error && (
          <Notice id={errorId} className="repo-error">
            {error}
          </Notice>
        )}
      </div>
    );
  }

  return (
    <form
      className="repo-form"
      onSubmit={(e) => {
        e.preventDefault();
        const value = draft.trim();
        if (value.length > 0) void send(value);
      }}
    >
      <Input
        label="Repository path"
        className="repo-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        // Not a label. It is here because the required shape of this value — absolute,
        // not relative — is not something the field name can convey.
        placeholder="C:\\path\\to\\your\\repo"
        spellCheck={false}
        autoComplete="off"
        disabled={pending || doc.conflicted}
        invalid={error ? errorId : false}
        data-testid="repo-path"
      />
      <Button
        variant="primary"
        type="submit"
        disabled={pending || doc.conflicted || draft.trim().length === 0}
      >
        {pending ? "Connecting…" : "Connect"}
      </Button>
      {error && (
        <Notice id={errorId} className="repo-error">
          {error}
        </Notice>
      )}
    </form>
  );
}

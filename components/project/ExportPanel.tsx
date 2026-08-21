"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";

interface FilePreview {
  name: string;
  next: string;
  current: string | null;
  clobbers: boolean;
}

interface Preview {
  target: string;
  files: FilePreview[];
}

interface Result {
  target: string;
  written: string[];
  overwritten: string[];
}

/**
 * Export the plan as files an agent can start from.
 *
 * ## Drawer, then dialog
 *
 * Choosing a folder and reading what would be written is *work*, so it happens in a
 * `Drawer` — the brief stays visible and clickable behind it, because deciding what to
 * export only makes sense next to the plan being exported.
 *
 * Overwriting someone's existing `CLAUDE.md` is a *decision*, and one git may not have a
 * copy of. That gets `ConfirmDialog`, which blocks and can name the files. Escape routes
 * through the shared layer stack, so dismissing the confirmation leaves the drawer open —
 * the user cancelled one thing and should lose one thing.
 *
 * ## Why the preview is a separate round trip
 *
 * The server has to read the target directory to know what is there, and the answer is the
 * whole point: an overwrite prompt that cannot say what it destroys is one people click
 * through. So "preview" and "write" are two requests, and the second sends back the
 * preview it is confirming rather than a fresh composition.
 */
export function ExportPanel({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const errorId = useId();

  async function send(confirm: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, target, confirm }),
      });
      const data = (await res.json()) as { preview?: Preview; result?: Result; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Export failed (${res.status})`);

      if (data.preview) setPreview(data.preview);
      if (data.result) setResult(data.result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const clobbering = preview?.files.filter((f) => f.clobbers) ?? [];

  function onWrite(): void {
    if (clobbering.length > 0) {
      setConfirming(true);
      return;
    }
    void send(true);
  }

  return (
    <section className="export-panel" data-testid="export-panel">
      <div className="row export-head">
        <p className="label">Export</p>
        <Button
          onClick={() => setOpen(true)}
          data-testid="export-open"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          Export for an agent
        </Button>
      </div>
      <p className="body-sm soft export-blurb">
        Writes a <span className="mono">CLAUDE.md</span> and a{" "}
        <span className="mono">TASKS.md</span> into a folder you choose, so a coding agent
        starts from this plan instead of from nothing.
      </p>

      {open && (
        <Drawer
          title={`Export ${name}`}
          testId="export-drawer"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button
                variant="primary"
                disabled={busy || !preview || result !== null}
                onClick={onWrite}
                data-testid="export-write"
              >
                {busy ? "Working…" : "Write these files"}
              </Button>
              <Button onClick={() => setOpen(false)}>Close</Button>
            </>
          }
        >
          <form
            className="stack export-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (target.trim().length > 0) void send(false);
            }}
          >
            <Input
              label="Folder to export into"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                // A preview belongs to one path. Keeping it visible after the field
                // changes would let someone confirm a write against a stale reading.
                setPreview(null);
                setResult(null);
              }}
              placeholder="C:\\path\\to\\the\\project"
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              invalid={error ? errorId : false}
              data-testid="export-target"
            />
            <Button type="submit" disabled={busy || target.trim().length === 0}>
              {busy ? "Reading…" : "Preview"}
            </Button>
          </form>

          {error && (
            <Notice id={errorId} data-testid="export-error">
              {error}
            </Notice>
          )}

          {/*
            The result stays on screen with the drawer open. Closing the pane in the success
            handler would destroy the only report of what happened and where - three bugs of
            that shape have shipped in this codebase.
          */}
          {result && (
            <Notice data-testid="export-result">
              Wrote {result.written.join(" and ")} to <span className="mono">{result.target}</span>
              {result.overwritten.length > 0
                ? `. Replaced ${result.overwritten.join(" and ")}.`
                : "."}
            </Notice>
          )}

          {preview && !result && (
            <div className="stack export-preview" data-testid="export-preview">
              <p className="body-sm soft">
                Into <span className="mono">{preview.target}</span>
              </p>
              {preview.files.map((file) => (
                <div className="export-file" key={file.name} data-testid="export-file">
                  <div className="row export-file-head">
                    <span className="mono">{file.name}</span>
                    {file.current === null ? (
                      <Chip tone="done">new file</Chip>
                    ) : file.clobbers ? (
                      <Chip tone="blocked">would replace</Chip>
                    ) : (
                      <Chip tone="paused">unchanged</Chip>
                    )}
                    <span className="body-sm faint">{lineCount(file.next)} lines</span>
                  </div>

                  {file.clobbers && file.current && (
                    <>
                      <p className="body-sm soft export-file-note">
                        There is already a {file.name} there, {lineCount(file.current)} lines
                        long. Writing replaces it.
                      </p>
                      {/*
                        The existing contents, not the new ones: this is the thing that
                        would be lost, and it is what the decision is about. Rendered as a
                        text node - a file from the user's disk never becomes markup.
                      */}
                      <pre className="export-file-body mono scroll-x">
                        {head(file.current, 24)}
                      </pre>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </Drawer>
      )}

      {confirming && (
        <ConfirmDialog
          title={clobbering.length === 1 ? "Replace this file?" : "Replace these files?"}
          body={
            <>
              <p className="body-sm">
                {clobbering.map((f) => f.name).join(" and ")} already{" "}
                {clobbering.length === 1 ? "exists" : "exist"} in{" "}
                <span className="mono">{preview?.target}</span>. Writing replaces{" "}
                {clobbering.length === 1 ? "it" : "them"}.
              </p>
              <p className="body-sm soft">
                Groundwork keeps no copy of what is there now. If that folder is a git
                repository, git does.
              </p>
            </>
          }
          confirmLabel="Replace"
          danger
          busy={busy}
          onConfirm={() => void send(true)}
          onCancel={() => setConfirming(false)}
          testId="export-confirm"
        />
      )}
    </section>
  );
}

function lineCount(text: string): number {
  const lines = text.split(/\r?\n/);
  // A trailing newline is not a line of content.
  return lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

function head(text: string, lines: number): string {
  const split = text.split(/\r?\n/);
  const shown = split.slice(0, lines).join("\n");
  return split.length > lines ? `${shown}\n…` : shown;
}

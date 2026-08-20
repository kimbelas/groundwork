"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

interface Preview {
  changed: string[];
  unchanged: string[];
  removed: string[];
  chunksToEmbed: number;
  chunksReused: number;
  skipped: number;
  approxTokens: number;
  estimatedSeconds: number;
  upToDate: boolean;
  embeddingsReady: boolean;
  embeddingsReason?: string;
}

/**
 * Build the index, after saying what it will cost.
 *
 * Two steps on purpose. Embedding is the only operation in this app that takes real time —
 * minutes on a large repository — and a button that silently starts one is a button that
 * looks broken. "Check" reads and hashes the files and reports how much work there is;
 * "Build" commits to it. That is also the honest place to say that a build blocks: the
 * estimate is shown before the decision, not after.
 */
export function IndexControls({ slug, built }: { slug: string; built: boolean }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"none" | "checking" | "building" | "clearing">("none");
  const [error, setError] = useState<string | null>(null);

  const pending = busy !== "none" || refreshing;

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(path, init);
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data as { error?: string } | null)?.error ?? `Failed (${res.status})`);
    }
    return data;
  }

  async function check() {
    setBusy("checking");
    setError(null);
    try {
      const data = (await call(`/api/index/${encodeURIComponent(slug)}?preview=1`)) as {
        preview?: Preview;
      };
      setPreview(data.preview ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("none");
    }
  }

  async function act(kind: "build" | "clear") {
    setBusy(kind === "build" ? "building" : "clearing");
    setError(null);
    try {
      await call(`/api/index/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      // The panel above reads its numbers on the server, so a refresh is what shows the
      // result. The preview is spent either way and would otherwise describe a past state.
      setPreview(null);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("none");
    }
  }

  return (
    <div className="index-actions" data-testid="index-controls">
      <Button onClick={() => void check()} disabled={pending}>
        {busy === "checking" ? "Checking…" : "Check for changes"}
      </Button>

      <Button variant="primary" onClick={() => void act("build")} disabled={pending}>
        {busy === "building" ? "Building…" : built ? "Update index" : "Build index"}
      </Button>

      {built && (
        <Button danger onClick={() => void act("clear")} disabled={pending}>
          {busy === "clearing" ? "Clearing…" : "Clear"}
        </Button>
      )}

      {preview && (
        <div className="index-preview body-sm" data-testid="index-preview">
          {preview.upToDate ? (
            <p className="index-line">The index is up to date. Nothing to embed.</p>
          ) : (
            <p className="index-line">
              {preview.chunksToEmbed.toLocaleString()} chunks to embed from{" "}
              {preview.changed.length.toLocaleString()}{" "}
              {preview.changed.length === 1 ? "file" : "files"}
              {preview.chunksReused > 0 && (
                <> · {preview.chunksReused.toLocaleString()} reused</>
              )}
              {preview.removed.length > 0 && <> · {preview.removed.length} removed</>}
              {" · about "}
              {preview.estimatedSeconds < 60
                ? `${preview.estimatedSeconds}s`
                : `${Math.ceil(preview.estimatedSeconds / 60)} min`}
            </p>
          )}

          {/*
            Said plainly rather than hidden. A keyword-only index is a real, useful thing —
            exact identifier lookups are what it is best at — but a user who thinks they
            have semantic search and does not would blame the results, not the model.
          */}
          {!preview.embeddingsReady && (
            <p className="index-line index-warn">
              {preview.embeddingsReason ??
                "The embedding model is unavailable, so this will be a keyword-only index."}
            </p>
          )}
        </div>
      )}

      {error && <Notice className="index-error">{error}</Notice>}
    </div>
  );
}

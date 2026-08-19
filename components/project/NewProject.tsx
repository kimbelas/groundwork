"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ARCHETYPES } from "@/lib/schema";
import { isValidSlug, slugify } from "@/lib/slug";

const ARCHETYPE_HELP: Record<(typeof ARCHETYPES)[number], string> = {
  "saas-mvp": "Shortest path to something worth paying for",
  "internal-tool": "Capture the manual process before replacing it",
  client: "Scope boundaries and explicit assumptions",
  "research-spike": "Questions and a kill criterion",
};

/**
 * Create a project.
 *
 * The slug is shown before submitting, because it becomes the folder name in the vault
 * and is immutable afterwards — discovering it only after the fact would mean renaming
 * a directory by hand to fix a typo.
 */
export function NewProject() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState<(typeof ARCHETYPES)[number]>("internal-tool");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = name.trim() ? slugify(name) : "";
  const slugOk = slug !== "" && isValidSlug(slug);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slugOk) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), slug, archetype }),
      });

      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (payload ?? {}) as { error?: string };
        throw new Error(detail.error ?? `Could not create the project (${res.status})`);
      }

      setName("");
      setOpen(false);
      // Straight into the brief: an empty project's only useful next step.
      router.push(`/p/${slug}/brief`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="button button-primary"
        onClick={() => setOpen(true)}
        data-testid="new-project"
      >
        New project
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="raised decision-form" data-testid="new-project-form">
      <label className="stack" style={{ gap: 6 }}>
        <span className="label">Project name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tenant Portal Rebuild"
          aria-label="Project name"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        />
        {slug && (
          <span className="body-sm faint" data-testid="slug-preview">
            Folder: <code className="mono">vault/{slug}</code>
          </span>
        )}
      </label>

      <label className="stack" style={{ gap: 6 }}>
        <span className="label">Kind of project</span>
        <select
          className="select"
          value={archetype}
          onChange={(e) => setArchetype(e.target.value as (typeof ARCHETYPES)[number])}
          aria-label="Kind of project"
          style={{ width: "100%" }}
        >
          {ARCHETYPES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <span className="body-sm faint">{ARCHETYPE_HELP[archetype]}</span>
      </label>

      {error && (
        <div className="notice body-sm" role="alert" data-testid="new-project-error">
          {error}
        </div>
      )}

      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <button type="submit" className="button button-primary" disabled={busy || !slugOk}>
          {busy ? "Creating..." : "Create project"}
        </button>
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          cancel
        </button>
      </div>
    </form>
  );
}

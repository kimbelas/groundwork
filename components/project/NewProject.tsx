"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { archetypeLabel } from "@/lib/labels";
import { ARCHETYPES } from "@/lib/schema";
import { isValidSlug, slugify } from "@/lib/slug";

const ARCHETYPE_HELP: Record<(typeof ARCHETYPES)[number], string> = {
  "saas-mvp": "Shortest path to something worth paying for",
  "internal-tool": "Capture the manual process before replacing it",
  client: "Scope boundaries and explicit assumptions",
  "research-spike": "Questions and a kill criterion",
};

/**
 * Create a project, in a drawer.
 *
 * It used to REPLACE its own trigger button with an inline form, so the form appeared
 * wherever the button had been - floating at the top-right of the header, detached from
 * the list it was about to add to, with the trigger gone so there was nothing to return
 * focus to on cancel.
 *
 * A drawer instead of a modal because the list of existing projects stays readable behind
 * it, which is exactly the context you want while naming a new one: it is how you notice
 * you already have a "Portal Rebuild".
 *
 * The slug is shown before submitting, because it becomes the folder name in the vault and
 * is immutable afterwards — discovering it only after the fact would mean renaming a
 * directory by hand to fix a typo.
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

  function close() {
    setOpen(false);
    setError(null);
  }

  return (
    <>
      {/*
        The trigger stays mounted while the drawer is open. It is what focus returns to on
        close, and unmounting it - which is what this component used to do - leaves a
        keyboard user at the top of the document with no idea where they were.
      */}
      <Button variant="primary" onClick={() => setOpen(true)} data-testid="new-project">
        New project
      </Button>

      {open && (
        <Drawer title="New project" onClose={close} testId="new-project-form">
          <form onSubmit={submit} className="stack-form" id="new-project-fields">
            <label className="field">
              <span className="label">Project name</span>
              <Input
                label="Project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tenant Portal Rebuild"
                autoFocus
              />
              {slug && (
                <span className="body-sm faint" data-testid="slug-preview">
                  Folder: <code className="mono">vault/{slug}</code>
                </span>
              )}
            </label>

            <label className="field">
              <span className="label">Kind of project</span>
              <select
                className="select field-control"
                value={archetype}
                onChange={(e) => setArchetype(e.target.value as (typeof ARCHETYPES)[number])}
                aria-label="Kind of project"
              >
                {/* Value stays the stored code; only the text is a word. */}
                {ARCHETYPES.map((a) => (
                  <option key={a} value={a}>
                    {archetypeLabel(a)}
                  </option>
                ))}
              </select>
              <span className="body-sm faint">{ARCHETYPE_HELP[archetype]}</span>
            </label>

            {error && <Notice data-testid="new-project-error">{error}</Notice>}
          </form>

          <div className="drawer-foot-inline">
            <Button
              variant="primary"
              type="submit"
              form="new-project-fields"
              disabled={busy || !slugOk}
            >
              {busy ? "Creating…" : "Create project"}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </Drawer>
      )}
    </>
  );
}

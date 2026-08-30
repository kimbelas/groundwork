"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { Select } from "@/components/ui/Select";
import { archetypeLabel } from "@/lib/labels";
import { ARCHETYPES } from "@/lib/schema";
import { folderNameOf, isValidSlug, nameFromFolder, slugify } from "@/lib/slug";

const ARCHETYPE_HELP: Record<(typeof ARCHETYPES)[number], string> = {
  "saas-mvp": "Shortest path to something worth paying for",
  "internal-tool": "Capture the manual process before replacing it",
  client: "Scope boundaries and explicit assumptions",
  "research-spike": "Questions and a kill criterion",
};

type Mode = "blank" | "repo";

/** Windows Explorer's "Copy as path" wraps the path in quotes. The server strips them
 *  too; this only mirrors it, so the preview agrees with what will be accepted. */
const unquote = (value: string): string => value.trim().replace(/^"(.*)"$/s, "$1");

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
 *
 * ## Starting from a repository
 *
 * A repository already has a name, and choosing a "kind of project" before writing a word
 * is a question most people answer arbitrarily. So the second mode asks for one thing — the
 * path — and derives the rest: the folder name becomes the project name, that becomes the
 * slug, and the archetype falls to the server's default. The project is created with the
 * repo already attached in a single write, so there is no state where a project exists but
 * the thing it was made for does not.
 *
 * The preview is best-effort and the server's answer wins. It canonicalises the path —
 * resolving symlinks, normalising separators — so the directory it really lands on can be
 * named differently from the string typed. That is why the redirect uses the slug that
 * comes back rather than the one shown.
 *
 * Blank stays the default. It is the existing path through this drawer, and a mode switch
 * is a cheaper thing to reach past than a field you did not want.
 */
export function NewProject() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("blank");
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [archetype, setArchetype] = useState<(typeof ARCHETYPES)[number]>("internal-tool");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoFolder = folderNameOf(unquote(repo));
  const derivedName = repoFolder ? nameFromFolder(repoFolder) : "";

  const effectiveName = mode === "repo" ? derivedName : name.trim();
  const slug = effectiveName ? slugify(effectiveName) : "";
  const slugOk = slug !== "" && isValidSlug(slug);

  /*
   * In repo mode a non-empty path is enough to submit.
   *
   * Whether it is absolute, exists, is a directory and sits outside the vault are all
   * questions only the filesystem can answer, and `lib/repo.ts` answers them with a
   * message that names the path and says what is wrong with it. Guessing here would mean
   * a second, worse copy of those rules that disagrees with the real one.
   */
  const ready = mode === "repo" ? unquote(repo).length > 0 : slugOk;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;

    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "repo" ? { repo: unquote(repo) } : { name: name.trim(), slug, archetype };

      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (payload ?? {}) as { error?: string };
        throw new Error(detail.error ?? `Could not create the project (${res.status})`);
      }

      /*
       * The slug comes from the response, not from the preview above. In repo mode the
       * server derives it from the canonical directory, which a symlink or a differently
       * cased path can make different from what was shown — and navigating to the local
       * guess would 404 on a project that was created perfectly.
       */
      const created = (payload ?? {}) as { slug?: string };
      const target = created.slug ?? slug;

      setName("");
      setRepo("");
      setOpen(false);
      // Straight into the brief: a new project's only useful next step.
      router.push(`/p/${target}/brief`);
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
              <span className="label">Start from</span>
              <Select
                label="Start from"
                className="field-control"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as Mode);
                  // The previous mode's failure does not describe this one.
                  setError(null);
                }}
                data-testid="new-project-mode"
              >
                <option value="blank">A blank project</option>
                <option value="repo">A repository</option>
              </Select>
            </label>

            {mode === "blank" ? (
              <>
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
                  <Select
                    label="Kind of project"
                    className="field-control"
                    value={archetype}
                    onChange={(e) => setArchetype(e.target.value as (typeof ARCHETYPES)[number])}
                  >
                    {/* Value stays the stored code; only the text is a word. */}
                    {ARCHETYPES.map((a) => (
                      <option key={a} value={a}>
                        {archetypeLabel(a)}
                      </option>
                    ))}
                  </Select>
                  <span className="body-sm faint">{ARCHETYPE_HELP[archetype]}</span>
                </label>
              </>
            ) : (
              <label className="field">
                <span className="label">Repository folder</span>
                <Input
                  label="Repository folder"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  // Not a label. The required shape — absolute, not relative — is not
                  // something the field name can carry.
                  placeholder="C:\path\to\your\repo"
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus
                  data-testid="new-project-repo"
                />
                <span className="body-sm faint">
                  In Explorer, right-click the folder and choose <em>Copy as path</em>, then
                  paste it here — the quotes it adds are fine.
                </span>
                {derivedName && (
                  <span className="body-sm faint" data-testid="slug-preview">
                    Creates <strong>{derivedName}</strong> in{" "}
                    <code className="mono">vault/{slug}</code>, with this repository already
                    connected.
                  </span>
                )}
              </label>
            )}

            {error && <Notice data-testid="new-project-error">{error}</Notice>}
          </form>

          <div className="drawer-foot-inline">
            <Button
              variant="primary"
              type="submit"
              form="new-project-fields"
              disabled={busy || !ready}
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

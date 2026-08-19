"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";

/** The clash message lives above the list; the rename field points at it by id. */
const ERROR_ID = "column-manager-error";

/**
 * Add, rename, reorder and remove board columns.
 *
 * Columns are declared once in `project.md`, and cards reference them by name — so a
 * rename has to rewrite every affected card, and a removal has to be refused while any
 * card still points at it. Both of those rules live in the vault layer; this is only the
 * surface for them.
 */
export function ColumnManager({
  slug,
  columns,
  mtimeMs,
}: {
  slug: string;
  columns: string[];
  mtimeMs: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(columns);
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which row is being renamed, and what it has been typed to so far. */
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);

  const dirty = draft.length !== columns.length || draft.some((c, i) => c !== columns[i]);

  function move(index: number, by: number) {
    const next = [...draft];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[target] = a;
    setDraft(next);
  }

  async function send(payload: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vault/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (data ?? {}) as { error?: string };
        throw new Error(detail.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    try {
      await send({ kind: "columns", columns: draft, expectedMtimeMs: mtimeMs });
      setOpen(false);
    } catch {
      // The message is already on screen; keep the panel open so it can be corrected.
    }
  }

  /**
   * Rename inline, rather than through `window.prompt`.
   *
   * The prompt dialog could not show the surrounding columns, could not be styled, could
   * not warn about a clash before sending, and on a phone it is a system sheet that hides
   * the thing being renamed. It also blocks the whole page, which for an action that
   * rewrites every card in a column is exactly backwards.
   */
  async function commitRename() {
    if (!renaming) return;
    const { from } = renaming;
    const to = renaming.to.trim();

    if (!to || to === from) {
      setRenaming(null);
      return;
    }
    if (draft.some((c) => c !== from && c.toLowerCase() === to.toLowerCase())) {
      setError(`There is already a column called "${to}".`);
      return;
    }

    try {
      await send({ kind: "rename-column", from, to, expectedMtimeMs: mtimeMs });
      setDraft((cols) => cols.map((c) => (c === from ? to : c)));
      setRenaming(null);
    } catch {
      /* reported above; the field stays open so the name can be corrected */
    }
  }

  if (!open) {
    return (
      <Button
        onClick={() => {
          setDraft(columns);
          setError(null);
          setRenaming(null);
          setOpen(true);
        }}
        data-testid="manage-columns"
      >
        Manage columns
      </Button>
    );
  }

  return (
    <section className="raised column-manager" data-testid="column-manager">
      <p className="label">Columns</p>

      {error && (
        <Notice id={ERROR_ID} data-testid="columns-error">
          {error}
        </Notice>
      )}

      <ul className="column-list">
        {draft.map((name, i) => (
          <li key={name} data-testid={`column-row-${name}`}>
            {renaming?.from === name ? (
              <form
                className="row"
                style={{ gap: 10, flex: 1 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void commitRename();
                }}
              >
                <Input
                  label={`Rename ${name}`}
                  value={renaming.to}
                  autoFocus
                  disabled={busy}
                  invalid={error ? ERROR_ID : false}
                  onChange={(e) => setRenaming({ from: name, to: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  style={{ maxWidth: 220 }}
                  data-testid={`rename-input-${name}`}
                />
                <Button type="submit" disabled={busy} data-testid={`rename-save-${name}`}>
                  {busy ? "Renaming..." : "Rename"}
                </Button>
                <Button variant="quiet" disabled={busy} onClick={() => setRenaming(null)}>
                  cancel
                </Button>
              </form>
            ) : (
              <>
                <span className="column-row-name">{name}</span>
                <div className="row" style={{ gap: 6 }}>
                  <IconButton
                    label={`Move ${name} earlier`}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={16} strokeWidth={2} />
                  </IconButton>
                  <IconButton
                    label={`Move ${name} later`}
                    disabled={busy || i === draft.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={16} strokeWidth={2} />
                  </IconButton>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => setRenaming({ from: name, to: name })}
                    data-testid={`rename-${name}`}
                  >
                    rename
                  </Button>
                  <Button
                    variant="quiet"
                    danger
                    disabled={busy || draft.length === 1}
                    aria-label={`Remove ${name}`}
                    onClick={() => setDraft((cols) => cols.filter((c) => c !== name))}
                    data-testid={`remove-${name}`}
                  >
                    remove
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      <form
        className="row"
        style={{ gap: 10, marginTop: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          const name = added.trim();
          if (!name) return;
          if (draft.some((c) => c.toLowerCase() === name.toLowerCase())) {
            setError(`There is already a column called "${name}".`);
            return;
          }
          setDraft((cols) => [...cols, name]);
          setAdded("");
          setError(null);
        }}
      >
        <Input
          label="New column name"
          value={added}
          onChange={(e) => setAdded(e.target.value)}
          placeholder="New column name"
          style={{ maxWidth: 260 }}
        />
        <Button type="submit" disabled={busy || !added.trim()}>
          Add
        </Button>
      </form>

      <div className="row" style={{ gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        <Button
          variant="primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
          data-testid="save-columns"
        >
          {busy ? "Saving..." : "Save order"}
        </Button>
        <Button
          variant="quiet"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
            setRenaming(null);
          }}
        >
          done
        </Button>
        <span className="body-sm faint">
          A rename updates every card in that column. A column holding cards cannot be
          removed.
        </span>
      </div>
    </section>
  );
}

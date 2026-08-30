"use client";

import { useDroppable } from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * A board lane. Separated by a vertical rule rather than a gap, and droppable in its
 * own right so an empty column can still receive a card.
 *
 * ## Why the list scrolls and the footer does not
 *
 * A first synthesis puts a dozen cards in one column, and an uncapped lane grows past the
 * bottom of the screen — so reading the second column means scrolling the page down and the
 * board sideways at the same time, and the column headings leave the viewport while you do
 * it. `.column-body` caps at roughly five cards and scrolls inside itself instead.
 *
 * "Add a card" moved out of that scroll area for the reason the cap exists: in a column of
 * fourteen it sat fourteen cards down, so the way to add a card was to scroll past every
 * card you were not adding. It is a footer now, always reachable.
 *
 * The droppable stays on the scrolling list, not on the section. It is the region a card can
 * actually land in, it is what `dragCardTo` in the e2e suite targets, and dnd-kit auto-scrolls
 * a scrollable drop target while you drag near its edge.
 */
export function Column({
  name,
  count,
  slug,
  children,
}: {
  name: string;
  count: number;
  slug: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: name });
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setError(null);
    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, title: trimmed, column: name }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `Could not create card (${res.status})`);
      }
      setTitle("");
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className={`column${isOver ? " column-over" : ""}`} aria-label={name}>
      <header className="column-head">
        <span className="label">{name}</span>
        <span className="column-count">{count}</span>
      </header>

      <div ref={setNodeRef} className="column-body" data-testid={`column-${name}`}>
        {children}
      </div>

      <div className="column-foot">
        {adding ? (
          <form onSubmit={create} className="stack" style={{ gap: 6 }}>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Card title"
              aria-label={`New card in ${name}`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setAdding(false);
                  setTitle("");
                }
              }}
            />
            {error && (
              <span className="mono" style={{ color: "var(--s-blocked)" }} role="alert">
                {error}
              </span>
            )}
          </form>
        ) : (
          <button
            type="button"
            className="column-add"
            onClick={() => setAdding(true)}
            aria-label={`Add a card to ${name}`}
          >
            + Add a card
          </button>
        )}
      </div>
    </section>
  );
}

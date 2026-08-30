"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Chip } from "@/components/ui/Chip";
import { confidenceLabel, priorityLabel, progressLabel, progressPercent, sizeLabel } from "@/lib/labels";

import type { BoardCard } from "./types";

/**
 * One card.
 *
 * Roomy and readable rather than dense: a 17px title, metadata in words instead of
 * codes, and criteria progress as a bar with a sentence under it. The stored values are
 * still `P1` / `M` / `0.8` — only the display is humanised (see lib/labels.ts).
 */
export function CardTile({
  card,
  href,
  selected,
  onOpen,
}: {
  card: BoardCard;
  /** The card's own page. Opened in a new tab by Ctrl/⌘-click or middle-click. */
  href: string;
  selected: boolean;
  onOpen: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={`card${selected ? " card-selected" : ""}`}
      data-testid={`card-${card.id}`}
      data-column={card.column}
      aria-current={selected ? "true" : undefined}
      {...attributes}
      {...listeners}
      /*
       * Plain click opens the drawer; a modifier or middle click opens the page in a new
       * tab, the way a link would. Not a nested <a>: the tile is a role="button" drag handle,
       * and interactive content inside it is invalid ARIA and would take the pointerdown
       * that starts a drag. The drawer's header link is the discoverable route.
       */
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) {
          window.open(href, "_blank", "noopener");
          return;
        }
        onOpen(card.id);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) window.open(href, "_blank", "noopener");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(card.id);
        }
      }}
    >
      <p className="card-title">{card.title}</p>

      {/* Separators are drawn by CSS on each item after the first, so a wrapped row
          never leaves one stranded at the end of a line. */}
      <div className="card-meta">
        {/*
          The card's own number, first in the row so the CSS separator never precedes it.

          The id already existed and is already permanent - `lib/vault.ts` never reuses one,
          even after a card is trashed - it was simply never on the tile, so the only way to
          quote a card was to open it. Written the same way the drawer and the card page
          write it, because three spellings of one identifier is how people stop trusting it.
        */}
        <span className="card-ticket">#{card.id}</span>
        {card.blocked ? (
          <Chip tone="blocked">Blocked</Chip>
        ) : (
          <span>{priorityLabel(card.priority)}</span>
        )}
        <span>{sizeLabel(card.size)}</span>
        <span>{confidenceLabel(card.confidence)}</span>
        {/* A pill rather than another separated item: it reads cleanly when the row
            wraps, where a leading "·" on a new line would not. */}
        {card.phase !== null && <span className="meta-pill">Phase {card.phase}</span>}
      </div>

      {card.total > 0 && (
        <div className="card-progress">
          <div
            className="bar"
            role="progressbar"
            aria-valuenow={card.done}
            aria-valuemin={0}
            aria-valuemax={card.total}
            aria-label="Acceptance criteria complete"
          >
            <span style={{ width: `${progressPercent(card.done, card.total)}%` }} />
          </div>
          <span className="body-sm soft">{progressLabel(card.done, card.total)}</span>
        </div>
      )}
    </article>
  );
}

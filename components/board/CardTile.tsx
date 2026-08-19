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
  selected,
  onOpen,
}: {
  card: BoardCard;
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
      onClick={() => onOpen(card.id)}
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

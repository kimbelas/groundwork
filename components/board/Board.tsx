"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { ColumnManager } from "./ColumnManager";
import { CardDetail } from "./CardDetail";
import { CardTile } from "./CardTile";
import { Column } from "./Column";
import type { BoardCard, BoardData } from "./types";

/**
 * The board.
 *
 * Moves are optimistic — the card lands where you dropped it immediately and the write
 * follows. On failure the previous arrangement is restored and the reason is shown,
 * because a drag that silently un-does itself is worse than one that explains.
 *
 * The client never computes an `order` value. It sends the destination column and
 * index; the server owns the arithmetic (see lib/ordering.ts), so two open tabs cannot
 * disagree about it.
 */
interface Override {
  column: string;
  order: number;
}

export function Board({ data }: { data: BoardData }) {
  const router = useRouter();

  /**
   * The server is the source of truth; this holds only optimistic overrides for moves
   * that have not yet been confirmed.
   *
   * Copying `data.cards` into state instead would freeze the board at its first render:
   * `useState` ignores a changed initial value, so nothing a `router.refresh()` fetched
   * — a created card, a deleted one, a renumbered column — would ever appear.
   */
  const [overrides, setOverrides] = useState<ReadonlyMap<number, Override>>(new Map());
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Drop overrides the server has caught up with. Done as a derivation rather than by
   * setting state in an effect, which would cascade renders — and it means a refreshed
   * board reconciles without a flash back to the old position.
   */
  const liveOverrides = useMemo(() => {
    if (overrides.size === 0) return overrides;
    const next = new Map(overrides);
    for (const [id, o] of overrides) {
      const server = data.cards.find((c) => c.id === id);
      if (!server || (server.column === o.column && server.order === o.order)) next.delete(id);
    }
    return next;
  }, [overrides, data.cards]);

  const cards = useMemo(
    () => data.cards.map((c) => ({ ...c, ...(liveOverrides.get(c.id) ?? {}) })),
    [data.cards, liveOverrides],
  );

  const clearOverride = useCallback((id: number) => {
    setOverrides((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const sensors = useSensors(
    // A small distance threshold keeps a click-to-open from registering as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byColumn = useMemo(() => {
    const map = new Map<string, BoardCard[]>();
    for (const col of data.columns) map.set(col, []);
    for (const card of cards) {
      // A card whose column was renamed out from under it still has to be reachable.
      const bucket = map.get(card.column);
      if (bucket) bucket.push(card);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order || a.id - b.id);
    return map;
  }, [cards, data.columns]);

  const orphans = useMemo(
    () => cards.filter((c) => !data.columns.includes(c.column)),
    [cards, data.columns],
  );

  const columnOf = useCallback(
    (id: number | string): string | null => {
      if (typeof id === "string" && data.columns.includes(id)) return id;
      return cards.find((c) => c.id === Number(id))?.column ?? null;
    },
    [cards, data.columns],
  );

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      setError(null);
      setDragging(cards.find((c) => c.id === Number(e.active.id)) ?? null);
    },
    [cards],
  );

  const onDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setDragging(null);
      const { active, over } = e;
      if (!over) return;

      const id = Number(active.id);
      const card = cards.find((c) => c.id === id);
      if (!card) return;

      const toColumn = columnOf(over.id);
      if (!toColumn) return;

      const destination = (byColumn.get(toColumn) ?? []).filter((c) => c.id !== id);
      const overIndex = destination.findIndex((c) => c.id === Number(over.id));
      const index = overIndex === -1 ? destination.length : overIndex;

      if (card.column === toColumn) {
        const current = (byColumn.get(toColumn) ?? []).findIndex((c) => c.id === id);
        if (current === index) return;
      }

      // Optimistic placement only needs to sort correctly on screen; the server decides
      // the value that lands on disk, so a fractional midpoint is fine here.
      const neighbourBefore = destination[index - 1]?.order ?? null;
      const neighbourAfter = destination[index]?.order ?? null;
      const provisional =
        neighbourBefore === null && neighbourAfter === null
          ? 100
          : neighbourBefore === null
            ? (neighbourAfter ?? 100) - 1
            : neighbourAfter === null
              ? neighbourBefore + 1
              : (neighbourBefore + neighbourAfter) / 2;

      setOverrides((prev) => new Map(prev).set(id, { column: toColumn, order: provisional }));

      try {
        const res = await fetch("/api/cards", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "move",
            slug: data.slug,
            id,
            column: toColumn,
            index,
            expectedMtimeMs: card.mtimeMs,
          }),
        });

        const payload: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const detail = (payload ?? {}) as { error?: string };
          throw new Error(detail.error ?? `Move failed (${res.status})`);
        }

        const ok = payload as { mtimeMs: number; order: number; renumbered: boolean };
        // Hold the override at the server's value until the refresh lands, so the card
        // does not flash back to its old slot; the derivation above drops it then.
        setOverrides((prev) => new Map(prev).set(id, { column: toColumn, order: ok.order }));
        router.refresh();
      } catch (err) {
        clearOverride(id);
        setError((err as Error).message);
      }
    },
    [byColumn, cards, clearOverride, columnOf, data.slug, router],
  );

  const selectedCard = selected === null ? null : (cards.find((c) => c.id === selected) ?? null);

  return (
    <div className="board-wrap">
      {error && (
        <div className="notice body-sm" role="alert" data-testid="board-error">
          {error} <span className="faint">The card was put back.</span>
        </div>
      )}

      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <ColumnManager
          slug={data.slug}
          columns={data.columns}
          mtimeMs={data.projectMtimeMs}
        />
      </div>

      {orphans.length > 0 && (
        <div className="notice body-sm" data-testid="orphan-notice">
          {orphans.length} card{orphans.length === 1 ? "" : "s"} reference a column this project
          no longer declares: {[...new Set(orphans.map((o) => o.column))].join(", ")}
        </div>
      )}

      {/*
        An explicit id is required, not cosmetic: without one dnd-kit derives its
        `aria-describedby` values from a module-level counter, which starts at a
        different number on the server than in the browser and hydrates mismatched.
      */}
      <DndContext
        id="groundwork-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="board" data-testid="board">
          {data.columns.map((column) => {
            const list = byColumn.get(column) ?? [];
            return (
              <SortableContext
                key={column}
                id={column}
                items={list.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <Column name={column} count={list.length} slug={data.slug}>
                  {list.map((card) => (
                    <CardTile
                      key={card.id}
                      card={card}
                      selected={card.id === selected}
                      onOpen={setSelected}
                    />
                  ))}
                </Column>
              </SortableContext>
            );
          })}
        </div>

        <DragOverlay>
          {dragging ? (
            <article className="card card-dragging">
              <p className="card-title">{dragging.title}</p>
            </article>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedCard && (
        // Keyed on id so selecting a different card remounts rather than resetting
        // state inside an effect.
        <CardDetail
          key={selectedCard.id}
          slug={data.slug}
          cardId={selectedCard.id}
          title={selectedCard.title}
          phases={data.phases}
          cards={data.cards}
          onClose={() => setSelected(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

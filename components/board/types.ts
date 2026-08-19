import type { CardMeta } from "@/lib/schema";

export interface BoardCard extends CardMeta {
  /** Write precondition for this card's file. */
  mtimeMs: number;
  /** Ticked / total acceptance criteria, precomputed server-side. */
  done: number;
  total: number;
}

export interface BoardData {
  slug: string;
  columns: string[];
  cards: BoardCard[];
  /** Write precondition for project.md, which is where columns are declared. */
  projectMtimeMs: number;
}

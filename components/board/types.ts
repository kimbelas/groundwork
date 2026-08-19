import type { CardMeta, Phase } from "@/lib/schema";

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
  /**
   * The phases `roadmap.md` declares.
   *
   * Carried so the card pane can offer the phases a project actually has rather than a
   * hard-coded 1 to 8. Cheap to include: `getProject` already parses them for the roadmap.
   */
  phases: Phase[];
}

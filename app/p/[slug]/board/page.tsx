import { Board } from "@/components/board/Board";
import type { BoardCard } from "@/components/board/types";
import { checklistProgress } from "@/lib/checklist";
import { getCard, getProject } from "@/lib/vault";

export const dynamic = "force-dynamic";

/**
 * Criteria counts are computed here rather than in the browser: the board summary needs
 * them for every card, and shipping every card's full prose to render "2/3" would make
 * the payload grow with the length of the writing rather than the number of cards.
 */
export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProject(slug);

  const cards: BoardCard[] = await Promise.all(
    project.cards.map(async (meta) => {
      try {
        const card = await getCard(slug, meta.id);
        const { done, total } = checklistProgress(card.body);
        return { ...meta, mtimeMs: card.mtimeMs, done, total };
      } catch {
        // A card that vanished between the index read and now is simply not shown.
        return { ...meta, mtimeMs: 0, done: 0, total: 0 };
      }
    }),
  );

  return (
    <Board
      data={{
        slug,
        columns: project.meta.columns,
        cards,
        projectMtimeMs: project.mtimeMs,
      }}
    />
  );
}

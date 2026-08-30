import Link from "next/link";
import { notFound } from "next/navigation";

import { CardEditor } from "@/components/board/CardEditor";
import { Backlinks } from "@/components/links/Backlinks";
import { Notice } from "@/components/ui/Notice";
import { Prose } from "@/components/ui/Prose";
import { descriptionOf } from "@/lib/checklist";
import { isVaultError } from "@/lib/errors";
import { cardNode } from "@/lib/links";
import { getCard, getProject } from "@/lib/vault";

import type { Card } from "@/lib/vault";

export const dynamic = "force-dynamic";

/**
 * One card, as a page.
 *
 * The drawer is where a card is worked on next to its neighbours; this is where it is read
 * on its own - the description the drawer never shows, the criteria and metadata through
 * the same `CardEditor`, what links here, and the card's enhancement history. Reachable in
 * a new tab from the drawer's header link or a Ctrl-click on the tile.
 *
 * The description is rendered paragraph by paragraph through `Prose`, which knows inline
 * emphasis and nothing else: a heading or a list inside the description shows as its
 * literal markdown. A block-aware renderer is a later change; a markdown-to-HTML pipeline
 * is not an option, because this text can come from an accepted AI proposal.
 */
export default async function CardPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id: rawId } = await params;
  if (!/^\d{1,6}$/.test(rawId)) notFound();
  const id = Number(rawId);

  let project;
  try {
    project = await getProject(slug);
  } catch (e) {
    if (isVaultError(e) && (e.code === "not_found" || e.code === "invalid_slug")) notFound();
    throw e;
  }

  /*
   * A card whose frontmatter did not parse is a page with a notice, not a 500. A file caught
   * mid-write, or one hand-edited into bad YAML, must not take the screen down - and the
   * fix is a person's, so the page says so and offers the way back.
   */
  let card: Card | null = null;
  let broken = false;
  try {
    card = await getCard(slug, id);
  } catch (e) {
    if (isVaultError(e) && e.code === "not_found") notFound();
    if (isVaultError(e) && e.code === "invalid_document") broken = true;
    else throw e;
  }

  const back = `/p/${slug}/board`;
  const paragraphs = card
    ? descriptionOf(card.body)
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  return (
    <div className="page-blocks card-page" data-testid="card-page">
      <div className="row card-page-head">
        <h2 className="display-sm card-page-title">
          #{id} · {card?.title ?? `card ${id}`}
        </h2>
        <Link href={back} className="link-button" data-testid="card-back">
          Back to board
        </Link>
      </div>

      {broken ? (
        <Notice data-testid="card-broken">
          This card&rsquo;s frontmatter did not parse, so nothing here can be edited until a
          person fixes the file. Open <code className="mono">vault/{slug}/cards/</code> in an
          editor.
        </Notice>
      ) : (
        <>
          <section className="card-page-description" data-testid="card-description">
            {paragraphs.length === 0 ? (
              <p className="body-sm faint">
                No description yet. Enhance with AI writes one from the brief.
              </p>
            ) : (
              paragraphs.map((text, i) => (
                <Prose key={`${i}-${text.slice(0, 24)}`} text={text} className="card-page-paragraph" />
              ))
            )}
          </section>

          <CardEditor
            slug={slug}
            cardId={id}
            phases={project.phases}
            cards={project.cards}
            trashRedirect={back}
          />

          <Backlinks node={cardNode(slug, id)} />
        </>
      )}
    </div>
  );
}

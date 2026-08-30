"use client";

import { ExternalLink } from "lucide-react";

import { Drawer } from "@/components/ui/Drawer";
import { cardHref } from "@/lib/links";

import { CardEditor } from "./CardEditor";

import type { Phase } from "@/lib/schema";

/**
 * Card detail, in a drawer.
 *
 * A drawer and not a modal, because the board behind it stays visible AND clickable: a
 * card only makes sense next to its column, and clicking a different card should swap the
 * panel rather than be swallowed by a scrim. It used to be docked in the layout, which
 * kept the context but shrank the board to make room on every screen it opened on.
 *
 * Everything inside is `CardEditor`, which the card's own page renders too. This component
 * is only the frame: the drawer, its heading, and the link to the page.
 */
export function CardDetail({
  slug,
  cardId,
  title,
  phases,
  cards,
  onClose,
}: {
  slug: string;
  cardId: number;
  /** From the board's server data; a rename shows here after the refresh that follows it. */
  title: string;
  phases: Phase[];
  cards: readonly { phase: number | null }[];
  onClose: () => void;
}) {
  return (
    <Drawer
      // The id is in the title because it is how a card is referred to everywhere else -
      // in a commit message, in a proposal, in the vault's filenames.
      title={`#${cardId} · ${title}`}
      onClose={onClose}
      testId="card-detail"
      headerActions={
        /*
         * The card's own page, in a new tab. A plain anchor styled as an icon button: 36px,
         * so it clears the tap floor on its own, and the keyboard-reachable route to the
         * page - the tile's Ctrl-click is a shortcut for people who already know it.
         */
        <a
          href={cardHref(slug, cardId)}
          target="_blank"
          rel="noopener"
          className="icon-button"
          aria-label="Open page"
          title="Open page"
          data-testid="card-open-page"
        >
          <span aria-hidden="true" className="icon-button-glyph">
            <ExternalLink size={16} strokeWidth={2} />
          </span>
        </a>
      }
    >
      <CardEditor slug={slug} cardId={cardId} phases={phases} cards={cards} onTrashed={onClose} />
    </Drawer>
  );
}

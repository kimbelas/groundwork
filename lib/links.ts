/**
 * Wiki-links and the backlink graph.
 *
 * Pure: it is given a description of the vault and returns resolutions. All disk access
 * stays in `lib/vault.ts`, which keeps every resolution rule exhaustively testable
 * without a filesystem.
 *
 * Resolution order is **slug before title**, so an exact slug always wins. An ambiguous
 * title — the same card name in two projects — resolves to nothing rather than guessing,
 * because a link that silently points at the wrong card is worse than one that visibly
 * does not point anywhere.
 */

export type LinkTarget =
  | { kind: "project"; slug: string }
  | { kind: "card"; slug: string; cardId: number }
  | { kind: "unresolved"; reason: "not-found" | "ambiguous" };

export interface WikiLink {
  /** Everything between the brackets, before any `|` label. */
  target: string;
  /** Display text after `|`, or null when the link has none. */
  label: string | null;
  /** Character offsets of the whole `[[...]]` in the source text. */
  start: number;
  end: number;
}

/**
 * `[[target]]` or `[[target|label]]`.
 *
 * A link cannot span a newline or contain a bracket: an unterminated `[[` is far more
 * likely to be someone mid-typing than a link across three paragraphs.
 */
const LINK = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]*))?\]\]/g;

export function parseWikiLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  LINK.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = LINK.exec(text)) !== null) {
    const target = (m[1] ?? "").trim();
    if (!target) continue;
    out.push({
      target,
      label: m[2] === undefined ? null : m[2].trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

export interface IndexedCard {
  id: number;
  title: string;
  /** Filename stem after the id: `0007-billing-api.md` -> `billing-api`. */
  fileSlug: string;
}

export interface IndexedProject {
  slug: string;
  name: string;
  cards: IndexedCard[];
}

const norm = (s: string) => s.trim().toLowerCase();

export function resolveLink(
  target: string,
  fromSlug: string,
  projects: readonly IndexedProject[],
): LinkTarget {
  const raw = target.trim();
  if (!raw) return { kind: "unresolved", reason: "not-found" };

  // ---- qualified: project/card
  if (raw.includes("/")) {
    const slash = raw.indexOf("/");
    const projectPart = norm(raw.slice(0, slash));
    const cardPart = norm(raw.slice(slash + 1));

    const project = projects.find((p) => norm(p.slug) === projectPart);
    if (!project) return { kind: "unresolved", reason: "not-found" };

    const byFileSlug = project.cards.find((c) => norm(c.fileSlug) === cardPart);
    if (byFileSlug) return { kind: "card", slug: project.slug, cardId: byFileSlug.id };

    const byTitle = project.cards.filter((c) => norm(c.title) === cardPart);
    if (byTitle.length === 1 && byTitle[0]) {
      return { kind: "card", slug: project.slug, cardId: byTitle[0].id };
    }
    if (byTitle.length > 1) return { kind: "unresolved", reason: "ambiguous" };

    return { kind: "unresolved", reason: "not-found" };
  }

  // ---- a project slug wins over anything else
  const project = projects.find((p) => norm(p.slug) === norm(raw));
  if (project) return { kind: "project", slug: project.slug };

  // ---- a card in the current project, before looking further afield
  const here = projects.find((p) => p.slug === fromSlug);
  if (here) {
    const local = here.cards.filter(
      (c) => norm(c.title) === norm(raw) || norm(c.fileSlug) === norm(raw),
    );
    if (local.length === 1 && local[0]) {
      return { kind: "card", slug: here.slug, cardId: local[0].id };
    }
    if (local.length > 1) return { kind: "unresolved", reason: "ambiguous" };
  }

  // ---- a card anywhere, but only if exactly one matches
  const matches: { slug: string; id: number }[] = [];
  for (const p of projects) {
    for (const c of p.cards) {
      if (norm(c.title) === norm(raw) || norm(c.fileSlug) === norm(raw)) {
        matches.push({ slug: p.slug, id: c.id });
      }
    }
  }
  if (matches.length === 1 && matches[0]) {
    return { kind: "card", slug: matches[0].slug, cardId: matches[0].id };
  }
  if (matches.length > 1) return { kind: "unresolved", reason: "ambiguous" };

  // ---- a project by display name, last so a slug can never be shadowed
  const byName = projects.filter((p) => norm(p.name) === norm(raw));
  if (byName.length === 1 && byName[0]) return { kind: "project", slug: byName[0].slug };
  if (byName.length > 1) return { kind: "unresolved", reason: "ambiguous" };

  return { kind: "unresolved", reason: "not-found" };
}

/** `portal-rebuild` for a project, `portal-rebuild/card-7` for a card. */
export type NodeId = string;

export function projectNode(slug: string): NodeId {
  return slug;
}

export function cardNode(slug: string, cardId: number): NodeId {
  return `${slug}/card-${cardId}`;
}

export function nodeOf(target: LinkTarget): NodeId | null {
  if (target.kind === "project") return projectNode(target.slug);
  if (target.kind === "card") return cardNode(target.slug, target.cardId);
  return null;
}

export interface LinkDoc {
  node: NodeId;
  /** Project the document belongs to, for resolving bare links. */
  slug: string;
  text: string;
}

export interface Backlink {
  from: NodeId;
  /** The source line, so the panel can show why something links here. */
  line: string;
}

export interface UnresolvedLink {
  from: NodeId;
  target: string;
  reason: "not-found" | "ambiguous";
}

export interface LinkGraph {
  forward: Map<NodeId, NodeId[]>;
  back: Map<NodeId, Backlink[]>;
  /** Links that point nowhere. A note to yourself, not an error — but worth listing. */
  unresolved: UnresolvedLink[];
}

/** The line containing `index`, without its terminators. */
function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end).trim();
}

export function buildLinkGraph(
  docs: readonly LinkDoc[],
  projects: readonly IndexedProject[],
): LinkGraph {
  const forward = new Map<NodeId, NodeId[]>();
  const back = new Map<NodeId, Backlink[]>();
  const unresolved: UnresolvedLink[] = [];

  for (const doc of docs) {
    for (const link of parseWikiLinks(doc.text)) {
      const resolved = resolveLink(link.target, doc.slug, projects);
      const to = nodeOf(resolved);

      if (!to) {
        unresolved.push({
          from: doc.node,
          target: link.target,
          reason: resolved.kind === "unresolved" ? resolved.reason : "not-found",
        });
        continue;
      }

      // A document linking to itself is not a backlink worth showing.
      if (to === doc.node) continue;

      const outgoing = forward.get(doc.node) ?? [];
      if (!outgoing.includes(to)) outgoing.push(to);
      forward.set(doc.node, outgoing);

      const incoming = back.get(to) ?? [];
      // One entry per source document, even when it links several times.
      if (!incoming.some((b) => b.from === doc.node)) {
        incoming.push({ from: doc.node, line: lineAt(doc.text, link.start) });
      }
      back.set(to, incoming);
    }
  }

  return { forward, back, unresolved };
}

import { describe, expect, it } from "vitest";

import {
  buildLinkGraph,
  cardNode,
  parseWikiLinks,
  resolveLink,
  type IndexedProject,
  type LinkDoc,
} from "@/lib/links";

/**
 * Wiki-link resolution.
 *
 * The rule that matters most is that ambiguity resolves to *nothing*. A link that
 * silently points at the wrong card is worse than one that visibly points nowhere, and
 * "same card title in two projects" is not a rare case in a planning vault.
 */

const PROJECTS: IndexedProject[] = [
  {
    slug: "portal-rebuild",
    name: "Portal Rebuild",
    cards: [
      { id: 7, title: "Billing API", fileSlug: "billing-api" },
      { id: 8, title: "Shared Name", fileSlug: "shared-name" },
      { id: 9, title: "Nav IA", fileSlug: "nav-ia" },
    ],
  },
  {
    slug: "translator-rates",
    name: "Translator Rates",
    cards: [
      { id: 1, title: "Rate cards", fileSlug: "rate-cards" },
      { id: 2, title: "Shared Name", fileSlug: "shared-name-two" },
    ],
  },
];

describe("parseWikiLinks", () => {
  it("finds a plain link with its offsets", () => {
    const links = parseWikiLinks("see [[billing-api]] for detail");
    expect(links).toHaveLength(1);
    expect(links[0]?.target).toBe("billing-api");
    expect(links[0]?.label).toBeNull();
    expect(links[0]?.start).toBe(4);
  });

  it("reads a label after a pipe", () => {
    const links = parseWikiLinks("[[portal-rebuild/billing-api|the billing work]]");
    expect(links[0]?.target).toBe("portal-rebuild/billing-api");
    expect(links[0]?.label).toBe("the billing work");
  });

  it("finds several links in one document", () => {
    expect(parseWikiLinks("[[a]] and [[b]] and [[c]]")).toHaveLength(3);
  });

  it("trims whitespace inside the brackets", () => {
    expect(parseWikiLinks("[[  billing-api  ]]")[0]?.target).toBe("billing-api");
  });

  it("ignores an unterminated link", () => {
    expect(parseWikiLinks("[[not closed")).toEqual([]);
    expect(parseWikiLinks("single [brackets]")).toEqual([]);
  });

  it("does not span a newline", () => {
    expect(parseWikiLinks("[[start\nend]]")).toEqual([]);
  });

  it("ignores an empty link", () => {
    expect(parseWikiLinks("[[]] and [[   ]]")).toEqual([]);
  });

  it("does not treat a markdown link as a wiki-link", () => {
    expect(parseWikiLinks("[text](http://example.com)")).toEqual([]);
  });
});

describe("resolveLink", () => {
  it("resolves a project slug", () => {
    expect(resolveLink("portal-rebuild", "translator-rates", PROJECTS)).toEqual({
      kind: "project",
      slug: "portal-rebuild",
    });
  });

  it("resolves a qualified card by file slug", () => {
    expect(resolveLink("portal-rebuild/billing-api", "translator-rates", PROJECTS)).toEqual({
      kind: "card",
      slug: "portal-rebuild",
      cardId: 7,
    });
  });

  it("resolves a qualified card by title", () => {
    expect(resolveLink("portal-rebuild/Billing API", "translator-rates", PROJECTS)).toEqual({
      kind: "card",
      slug: "portal-rebuild",
      cardId: 7,
    });
  });

  it("is case-insensitive", () => {
    expect(resolveLink("PORTAL-REBUILD/BILLING-API", "x", PROJECTS)).toEqual({
      kind: "card",
      slug: "portal-rebuild",
      cardId: 7,
    });
  });

  it("prefers a card in the current project for a bare name", () => {
    // "Shared Name" exists in both projects; the local one wins.
    expect(resolveLink("Shared Name", "translator-rates", PROJECTS)).toEqual({
      kind: "card",
      slug: "translator-rates",
      cardId: 2,
    });
    expect(resolveLink("Shared Name", "portal-rebuild", PROJECTS)).toEqual({
      kind: "card",
      slug: "portal-rebuild",
      cardId: 8,
    });
  });

  it("refuses to guess when a bare name is ambiguous across projects", () => {
    // Linking from a third project, neither match is local — so neither is chosen.
    expect(resolveLink("Shared Name", "some-other-project", PROJECTS)).toEqual({
      kind: "unresolved",
      reason: "ambiguous",
    });
  });

  it("resolves a bare card name that is unique across the vault", () => {
    expect(resolveLink("Rate cards", "portal-rebuild", PROJECTS)).toEqual({
      kind: "card",
      slug: "translator-rates",
      cardId: 1,
    });
  });

  it("puts a project slug ahead of a card title", () => {
    const shadowed: IndexedProject[] = [
      {
        slug: "billing-api",
        name: "Billing API Project",
        cards: [],
      },
      {
        slug: "other",
        name: "Other",
        cards: [{ id: 1, title: "billing-api", fileSlug: "billing-api" }],
      },
    ];
    expect(resolveLink("billing-api", "other", shadowed)).toEqual({
      kind: "project",
      slug: "billing-api",
    });
  });

  it("resolves a project by display name, but only after slugs and cards", () => {
    expect(resolveLink("Portal Rebuild", "translator-rates", PROJECTS)).toEqual({
      kind: "project",
      slug: "portal-rebuild",
    });
  });

  it("reports a missing target rather than throwing", () => {
    expect(resolveLink("nothing-here", "portal-rebuild", PROJECTS)).toEqual({
      kind: "unresolved",
      reason: "not-found",
    });
    expect(resolveLink("no-such-project/card", "portal-rebuild", PROJECTS)).toEqual({
      kind: "unresolved",
      reason: "not-found",
    });
  });

  it("reports a qualified card that does not exist", () => {
    expect(resolveLink("portal-rebuild/ghost", "portal-rebuild", PROJECTS)).toEqual({
      kind: "unresolved",
      reason: "not-found",
    });
  });

  it("handles an empty vault", () => {
    expect(resolveLink("anything", "x", [])).toEqual({ kind: "unresolved", reason: "not-found" });
  });
});

describe("buildLinkGraph", () => {
  const docs: LinkDoc[] = [
    {
      node: "portal-rebuild",
      slug: "portal-rebuild",
      text: "The brief mentions [[translator-rates]] and\nalso [[Rate cards]] on this line.",
    },
    {
      node: cardNode("portal-rebuild", 7),
      slug: "portal-rebuild",
      text: "Depends on [[nav-ia]].",
    },
    {
      node: "translator-rates",
      slug: "translator-rates",
      text: "Points at [[nothing-here]] which does not exist.",
    },
  ];

  it("records forward links", () => {
    const graph = buildLinkGraph(docs, PROJECTS);
    expect(graph.forward.get("portal-rebuild")).toEqual([
      "translator-rates",
      cardNode("translator-rates", 1),
    ]);
  });

  it("records backlinks with the source line", () => {
    const graph = buildLinkGraph(docs, PROJECTS);
    const incoming = graph.back.get("translator-rates");
    expect(incoming).toHaveLength(1);
    expect(incoming?.[0]?.from).toBe("portal-rebuild");
    expect(incoming?.[0]?.line).toContain("The brief mentions");
  });

  it("takes the line the link is actually on, not the first line", () => {
    const graph = buildLinkGraph(docs, PROJECTS);
    const incoming = graph.back.get(cardNode("translator-rates", 1));
    expect(incoming?.[0]?.line).toBe("also [[Rate cards]] on this line.");
  });

  it("resolves a bare link relative to the linking document's project", () => {
    const graph = buildLinkGraph(docs, PROJECTS);
    // "nav-ia" is bare and lives in portal-rebuild, the linking card's project.
    expect(graph.forward.get(cardNode("portal-rebuild", 7))).toEqual([
      cardNode("portal-rebuild", 9),
    ]);
  });

  it("collects unresolved links instead of dropping them", () => {
    const graph = buildLinkGraph(docs, PROJECTS);
    expect(graph.unresolved).toEqual([
      { from: "translator-rates", target: "nothing-here", reason: "not-found" },
    ]);
  });

  it("does not record a document linking to itself", () => {
    const graph = buildLinkGraph(
      [{ node: "portal-rebuild", slug: "portal-rebuild", text: "see [[portal-rebuild]]" }],
      PROJECTS,
    );
    expect(graph.forward.size).toBe(0);
    expect(graph.back.size).toBe(0);
  });

  it("records one backlink per source even when it links repeatedly", () => {
    const graph = buildLinkGraph(
      [
        {
          node: "portal-rebuild",
          slug: "portal-rebuild",
          text: "[[translator-rates]] and again [[translator-rates]]",
        },
      ],
      PROJECTS,
    );
    expect(graph.back.get("translator-rates")).toHaveLength(1);
    expect(graph.forward.get("portal-rebuild")).toEqual(["translator-rates"]);
  });

  it("returns empty structures for no documents", () => {
    const graph = buildLinkGraph([], PROJECTS);
    expect(graph.forward.size).toBe(0);
    expect(graph.back.size).toBe(0);
    expect(graph.unresolved).toEqual([]);
  });
});

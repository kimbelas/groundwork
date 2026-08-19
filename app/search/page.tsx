import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { searchVault } from "@/lib/vault";

export const dynamic = "force-dynamic";

/**
 * Vault-wide search.
 *
 * A page with a plain GET form rather than a live-filtering client component: the query
 * lives in the URL, so a result set is linkable and survives a reload. Search runs on
 * the server where the files are.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const hits = query.length >= 2 ? await searchVault(query) : [];

  const grouped = new Map<string, typeof hits>();
  for (const hit of hits) {
    const list = grouped.get(hit.slug) ?? [];
    list.push(hit);
    grouped.set(hit.slug, list);
  }

  return (
    <>
      <h1 className="display-lg" style={{ margin: "0 0 22px" }}>
        Search
      </h1>

      {/*
        This page is a server component, and the primitives below are used from it without
        pulling anything into the client bundle — which is the whole reason they carry no
        "use client" directive. A hook-free primitive stays usable on both sides; the
        directive is for the ones that will wrap a third-party library.
      */}
      <form method="get" action="/search" className="row" style={{ gap: 12, marginBottom: 28 }}>
        <Input
          label="Search the vault"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Find anything in the vault"
          style={{ maxWidth: 460 }}
          autoFocus
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>

      {query.length > 0 && query.length < 2 && (
        <p className="body-sm soft">Type at least two characters.</p>
      )}

      {query.length >= 2 && hits.length === 0 && (
        <div className="empty" data-testid="search-empty">
          <p className="display-sm" style={{ margin: "0 0 6px" }}>
            Nothing matched “{query}”
          </p>
          <p className="body-sm" style={{ margin: 0 }}>
            Search covers briefs, cards, decision logs, risks and questions.
          </p>
        </div>
      )}

      {hits.length > 0 && (
        <div className="stack" style={{ gap: 26 }} data-testid="search-results">
          <p className="body-sm soft">
            {hits.length} match{hits.length === 1 ? "" : "es"} in {grouped.size} project
            {grouped.size === 1 ? "" : "s"}
          </p>

          {[...grouped.entries()].map(([slug, list]) => (
            <section key={slug} data-testid={`search-group-${slug}`}>
              <p className="label" style={{ marginBottom: 10 }}>
                {list[0]?.projectName ?? slug}
              </p>
              <ul className="search-list">
                {list.map((hit, i) => (
                  <li key={`${hit.where}-${i}`}>
                    <Link href={hit.href} className="body-sm">
                      {hit.where}
                    </Link>
                    <p className="search-line">{hit.line}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

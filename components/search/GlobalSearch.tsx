import { Input } from "@/components/ui/Input";

/**
 * Vault-wide search, always at the top of the shell.
 *
 * A plain GET form, not a client component: the query belongs in the URL so a result set is
 * linkable and survives a reload, and searching runs on the server where the files are. It
 * pulls nothing into the client bundle — `Input` is hook-free for exactly this reason — even
 * though the shell around it is a client component.
 *
 * No submit button. Enter submits a single-field form natively, and a second control labelled
 * "Search" would collide with the one on `/search` itself: two buttons of that name on the
 * same page is an ambiguous locator, and the suite already binds to that one.
 *
 * Labelled "Search all projects" rather than "Search the vault" for the same reason — the
 * search page's own field owns that name, and this bar renders on that page too.
 */
export function GlobalSearch() {
  return (
    <form method="get" action="/search" role="search" className="topbar-search">
      <Input
        label="Search all projects"
        type="search"
        name="q"
        className="topbar-search-input"
        // The card-number form is not discoverable otherwise, and it is the fastest way
        // back to a card someone wrote down on paper.
        placeholder="Search all projects, or a card number like #7"
        autoComplete="off"
        spellCheck={false}
        data-testid="global-search"
      />
    </form>
  );
}

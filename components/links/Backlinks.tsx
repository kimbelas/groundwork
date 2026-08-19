import Link from "next/link";

import { getBacklinks } from "@/lib/vault";

/**
 * What links here.
 *
 * Each entry shows the source line, not just the source name — the useful question is
 * *why* something points here, and that is answerable at a glance from the sentence the
 * link sits in.
 *
 * A server component: the graph lives on the server and is cached there, so this costs
 * nothing extra on the client.
 */
export async function Backlinks({ node }: { node: string }) {
  const links = await getBacklinks(node);
  if (links.length === 0) return null;

  return (
    <section className="backlinks" data-testid="backlinks">
      <p className="label">
        Linked from ({links.length})
      </p>
      <ul className="backlink-list">
        {links.map((b) => (
          <li key={b.from} data-testid={`backlink-${b.from}`}>
            <Link href={b.href}>{b.label}</Link>
            <p className="body-sm soft backlink-line">{b.line}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

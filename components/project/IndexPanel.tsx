import { Chip } from "@/components/ui/Chip";
import { summarizeIndex } from "@/lib/index/store";

import { IndexControls } from "./IndexControls";

/**
 * The searchable index built from a connected repository.
 *
 * Only rendered when a repo is connected — an index with nothing to index is a control with
 * no meaning. Reads only the manifest, so this costs one small file read on a page that is
 * `force-dynamic`; counting chunks by loading them would pull megabytes to print a number.
 *
 * Says what the index cost and when it was built, because both are the questions a user has
 * about a cache: is this current, and what is it taking up.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  // Date only. A relative time would need a clock on the client and re-render to stay true,
  // and "which day" is the resolution anyone actually wants for a cache.
  return then.toISOString().slice(0, 10);
}

export async function IndexPanel({ slug }: { slug: string }) {
  const summary = await summarizeIndex(slug);

  return (
    <section className="index-panel" data-testid="index-panel" aria-labelledby="index-heading">
      <div className="index-head">
        <h2 id="index-heading" className="index-title">
          Search index
        </h2>
        {summary.built && (
          <Chip tone={summary.keywordOnly ? "idea" : "active"}>
            {summary.keywordOnly ? "Keyword only" : "Ready"}
          </Chip>
        )}
      </div>

      {summary.built ? (
        <p className="index-note body-sm" data-testid="index-summary">
          {summary.chunkCount.toLocaleString()} chunks from{" "}
          {summary.fileCount.toLocaleString()} files · {formatBytes(summary.bytes)}
          {formatWhen(summary.builtAt) && <> · built {formatWhen(summary.builtAt)}</>}
        </p>
      ) : (
        <p className="index-note body-sm">
          Indexing the repository lets planning search the code that exists rather than only
          the brief. It runs entirely on this machine, and the index is disposable — delete
          it any time and rebuild.
        </p>
      )}

      {summary.built && summary.keywordOnly && (
        <p className="index-note body-sm">
          This index was built without the embedding model, so search matches exact terms
          rather than meaning. Rebuilding once the model is available upgrades it.
        </p>
      )}

      <IndexControls slug={slug} built={summary.built} />
    </section>
  );
}

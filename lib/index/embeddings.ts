import { normalize } from "./similarity";

/**
 * On-device embeddings. Optional, by design.
 *
 * ## Why local
 *
 * The whole product premise is that a plan lives in a folder on your machine and nothing
 * leaves it. Sending every chunk of a private repository to an embedding API would
 * contradict that for a quality difference retrieval barely notices at this scale, and it
 * would put a per-token price on the one operation the app wants to do freely.
 *
 * ## Why optional
 *
 * The model is a real download — hundreds of megabytes, fetched on first use. On a machine
 * that has never run it, or has no network, `embed` cannot work. That must not mean search
 * cannot work: the keyword ranker needs nothing, so retrieval degrades to keyword-only and
 * says so, rather than failing.
 *
 * This is why every function here reports availability instead of throwing, and why
 * nothing above it treats a vector as guaranteed to exist.
 */

/** 384 dimensions, unit length. Pinned so a stored index can be checked against it. */
export const MODEL = "Xenova/all-MiniLM-L6-v2";
export const DIMS = 384;

/**
 * int8-quantized weights: smaller download, faster on CPU, negligible quality loss for
 * this model. The repo this came from verified its recall gate stayed green on q8.
 */
const DTYPE = "q8";

/** Texts per forward pass. Larger is faster and uses more memory; 16 is the ported value. */
export const BATCH_SIZE = 16;

/**
 * The pipeline is a function with no useful public type, so it is held as one.
 *
 * `@huggingface/transformers` types `pipeline()` as a large union keyed on task, and the
 * feature-extraction member is not exported in a form worth reconstructing. This is the
 * one place that shape is unknown, and it is contained to this module — everything
 * outside sees `Float32Array`.
 */
type Extractor = (
  input: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist: () => number[][]; data: Float32Array }>;

let extractor: Extractor | null = null;
let loadFailure: string | null = null;
let loading: Promise<Extractor | null> | null = null;

/**
 * Load the model once, and remember a failure so a broken environment is not retried on
 * every keystroke.
 *
 * The import is dynamic so that merely importing this module does not pull the runtime
 * into a bundle. Next would otherwise trace it into any route that touches retrieval.
 */
async function getExtractor(): Promise<Extractor | null> {
  if (extractor) return extractor;
  if (loadFailure) return null;
  if (loading) return loading;

  loading = (async () => {
    try {
      const mod = await import("@huggingface/transformers");
      const pipe = await mod.pipeline("feature-extraction", MODEL, { dtype: DTYPE });
      extractor = pipe as unknown as Extractor;
      return extractor;
    } catch (e) {
      loadFailure = (e as Error).message;
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

export interface Availability {
  ready: boolean;
  /** Why not, when `ready` is false — shown to the user, so it must be a sentence. */
  reason?: string;
}

/**
 * Whether embeddings can be used, loading the model if it is not loaded yet.
 *
 * Callers use this to decide between hybrid and keyword-only retrieval, and to tell the
 * user which they got. Silently returning worse results is the one option not on offer.
 */
export async function embeddingsAvailable(): Promise<Availability> {
  const e = await getExtractor();
  if (e) return { ready: true };
  return {
    ready: false,
    reason:
      loadFailure ??
      "The on-device embedding model is not available. Search will use keyword matching only.",
  };
}

/** Forget a cached failure, so a retry is possible after a network comes back. */
export function resetEmbeddings(): void {
  extractor = null;
  loadFailure = null;
  loading = null;
}

/**
 * Embed one text. Returns null when the model is unavailable.
 *
 * Null rather than a throw: an unavailable model is an expected state on a fresh machine,
 * not an error, and every caller has a keyword path to fall back to.
 */
export async function embed(text: string): Promise<Float32Array | null> {
  const e = await getExtractor();
  if (!e) return null;

  const out = await e(text, { pooling: "mean", normalize: true });
  return new Float32Array(out.data);
}

/**
 * Embed many texts, batched.
 *
 * Batching is the difference between an index that builds in a minute and one that takes
 * ten: the model processes a whole batch in a single forward pass. Mean pooling uses the
 * attention mask, so a vector from a batch is identical to the same text embedded alone —
 * batching is purely a speed change and cannot move a retrieval result.
 *
 * `onProgress` exists because this is the slow operation in the product and a progress
 * bar that does not move looks like a hang.
 */
export async function embedBatch(
  texts: string[],
  opts: { batchSize?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<Float32Array | null> {
  if (texts.length === 0) return new Float32Array(0);

  const e = await getExtractor();
  if (!e) return null;

  const batchSize = Math.max(1, opts.batchSize ?? BATCH_SIZE);
  const out = new Float32Array(texts.length * DIMS);
  let written = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const result = await e(batch, { pooling: "mean", normalize: true });

    for (const row of result.tolist()) {
      /*
       * Re-normalise rather than trusting the flag.
       *
       * `normalize: true` is asked for and honoured, but the ranking step drops the
       * magnitude division on the promise that these are unit length. If that promise is
       * ever wrong — a model swap, a library change — every score would be silently
       * scaled and the ordering subtly wrong, which is far harder to notice than a crash.
       * This costs one pass over 384 floats.
       */
      const vec = normalize(new Float32Array(row));
      out.set(vec, written * DIMS);
      written += 1;
    }

    opts.onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
  }

  // A short result would leave trailing zeros that rank as "no similarity to anything",
  // which is a wrong answer rather than a missing one.
  return written === texts.length ? out : out.subarray(0, written * DIMS);
}

import matter from "gray-matter";

/**
 * The one write rule (docs/03-data-model.md).
 *
 * gray-matter — like every YAML round-tripper — re-serializes on stringify: quote
 * style shifts, comments vanish, key order can move. So we never parse-and-rewrite a
 * whole file to change one half of it. We split the raw text into a verbatim
 * frontmatter block and a verbatim body, and rewrite only the half being edited.
 *
 * gray-matter is used for *reading* the YAML into data, never for reconstituting the
 * half we are leaving alone. That is what makes "the untouched half is byte-identical"
 * a testable promise instead of a hope.
 */

export interface SplitDoc {
  /** Verbatim frontmatter block, delimiters and trailing newline included. "" if absent. */
  head: string;
  /** Verbatim remainder of the file. */
  body: string;
}

const BOM = "﻿";

export function split(raw: string): SplitDoc {
  const bom = raw.startsWith(BOM) ? BOM : "";
  const s = bom ? raw.slice(BOM.length) : raw;

  if (!/^---[ \t]*(\r?\n|$)/.test(s)) return { head: "", body: raw };

  const firstBreak = s.indexOf("\n");
  if (firstBreak === -1) return { head: "", body: raw };

  let pos = firstBreak + 1;
  while (pos <= s.length) {
    const nl = s.indexOf("\n", pos);
    const lineEnd = nl === -1 ? s.length : nl;
    const line = s.slice(pos, lineEnd).replace(/\r$/, "");

    if (line.trimEnd() === "---") {
      const headEnd = nl === -1 ? s.length : nl + 1;
      return { head: bom + s.slice(0, headEnd), body: s.slice(headEnd) };
    }
    if (nl === -1) break;
    pos = nl + 1;
  }

  // Unterminated frontmatter is not frontmatter. Treating it as body means a
  // half-typed file is preserved rather than silently reinterpreted.
  return { head: "", body: raw };
}

/** Parsed YAML, or `{}` when there is no frontmatter. Never throws on absent data. */
export function readData(raw: string): Record<string, unknown> {
  const { head } = split(raw);
  if (!head) return {};
  try {
    const parsed = matter(head).data as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A YAML syntax error is a document problem, not a crash. The caller decides
    // how loudly to complain; returning {} lets one bad file stay one bad file.
    return {};
  }
}

/** True when the frontmatter exists but does not parse — worth surfacing to the user. */
export function hasBrokenFrontmatter(raw: string): boolean {
  const { head } = split(raw);
  if (!head) return false;
  try {
    matter(head);
    return false;
  } catch {
    return true;
  }
}

function detectEol(sample: string): "\r\n" | "\n" {
  return sample.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Make a parsed frontmatter object safe to hand back to YAML.
 *
 * YAML has no representation for undefined, and js-yaml does not skip it - it throws
 * `unacceptable kind of an object to dump`, which surfaces as a 500 with no useful message.
 * An optional field is the trigger: `{...meta, ...patch}` where the patch carries
 * `field: undefined` produces a present key with no value, and every writer that touches an
 * optional field can reach it.
 *
 * Removing the key is the only sane reading. "This field has no value" and "this field is
 * absent" are the same statement in frontmatter, and a caller that means something else has
 * to say so - see how `repo` uses `null` for an explicit disconnect.
 *
 * Recursive, because a shallow filter only covers the top level and the aux documents
 * (`roadmap.md`, `risks.md`, `questions.md`) are nested by nature - one `undefined` inside a
 * phase or a risk would throw exactly the same way. An `undefined` inside an ARRAY becomes
 * `null` rather than vanishing, because dropping it would silently shorten the list.
 *
 * Flow sequences do come back as block sequences - `[a, b]` becomes a dashed list. That is
 * accepted churn: it happens once per file and is stable after, and fixing it would mean
 * splicing raw YAML rather than round-tripping it.
 */
export function forYaml(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : forYaml(v)));

  /*
   * A Date goes back out the way a person writes one.
   *
   * gray-matter parses `due: 2026-01-01` into a Date, and dumping that produces
   * `2026-01-01T00:00:00.000Z`. For a key this app manages that never shows, because zod
   * hands back a validated string - but a key it merely PRESERVES came from the file and
   * goes straight back, so a hand-written date silently grew a time and a timezone on the
   * first unrelated edit. Midnight UTC is date-only by construction here, since that is
   * what a bare `YYYY-MM-DD` parses to.
   */
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }

  // Dates and every other class instance pass through whole. Recursing into one would
  // rebuild it as a plain object and lose what YAML needs to serialize it.
  if (value === null || typeof value !== "object") return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = forYaml(v);
  }
  return out;
}

function serializeHead(data: Record<string, unknown>, eol: "\r\n" | "\n"): string {
  // gray-matter appends a newline for the (empty) content it was given, which would
  // otherwise leak into the caller's body and break the byte-identical promise.
  // Running the output back through our own splitter takes exactly the head and
  // nothing after it, whatever gray-matter decides to pad with.
  const generated = matter.stringify("", forYaml(data) as Record<string, unknown>);
  const head = split(generated).head || generated;
  return eol === "\n" ? head : head.replace(/\r?\n/g, eol);
}

/** Replace the body. The frontmatter block is carried across byte-for-byte. */
export function replaceBody(raw: string, newBody: string): string {
  const { head } = split(raw);
  return head + newBody;
}

/** Replace the frontmatter. The body is carried across byte-for-byte. */
export function replaceData(raw: string, data: Record<string, unknown>): string {
  const { head, body } = split(raw);
  const eol = detectEol(head || body || "\n");
  return serializeHead(data, eol) + body;
}

/** Build a fresh document. Only for files that do not exist yet. */
export function buildDoc(data: Record<string, unknown>, body: string, eol: "\r\n" | "\n" = "\n"): string {
  return serializeHead(data, eol) + body;
}

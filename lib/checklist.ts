/**
 * Acceptance criteria are markdown task-list items in the card body.
 *
 * They live in the prose rather than in frontmatter on purpose: a criterion is a
 * sentence, it belongs next to the description that motivates it, and it stays useful
 * when the file is opened in Obsidian or read by the CLI.
 *
 * Every function here is pure and preserves the bytes it is not deliberately changing —
 * ticking a box must not reflow, re-indent, or normalise the rest of the card. The same
 * contract holds for the editing helpers below: an edit rewrites one line's text, a removal
 * splices one element out of the split array, a move swaps two lines' content, and an
 * insertion adds one item line — plus the blank line a heading needs when nothing sat under
 * it yet, or a whole new section when the body had none. Existing lines are never rewritten
 * by an insertion. A line's trailing `\r` belongs to its *position*, not to its text, so a
 * mixed-ending file cannot have a CR migrate when items move.
 */

/** `- [ ] text`, `* [x] text`, `+ [X] text`, with any leading indentation. */
const ITEM = /^(\s*[-*+]\s+\[)([ xX])(\]\s?)(.*)$/;

/** The heading the app writes. Reading is case-insensitive and level-agnostic; see below. */
export const ACCEPTANCE_HEADING = "## Acceptance criteria";

/** `## Acceptance criteria`, any level, any case, optional closing hashes. */
const HEADING = /^(#{1,6})[ \t]+acceptance criteria[ \t]*#*[ \t]*$/i;
const ANY_HEADING = /^(#{1,6})[ \t]+\S/;

export interface ChecklistItem {
  /** Zero-based index among task-list items in this body, in document order. */
  index: number;
  /** Zero-based line number in the body. */
  line: number;
  checked: boolean;
  text: string;
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function crOf(line: string): string {
  return line.endsWith("\r") ? "\r" : "";
}

function eolOf(body: string): string {
  return body.includes("\r\n") ? "\r\n" : "\n";
}

export function parseChecklist(body: string): ChecklistItem[] {
  const lines = body.split("\n");
  const out: ChecklistItem[] = [];

  lines.forEach((raw, line) => {
    const m = ITEM.exec(raw.replace(/\r$/, ""));
    if (!m) return;
    out.push({
      index: out.length,
      line,
      checked: m[2] !== " ",
      text: (m[4] ?? "").trim(),
    });
  });

  return out;
}

/**
 * Flip the nth task-list item.
 *
 * Only the single marker character changes; the marker style, indentation, spacing and
 * every other line are carried across untouched. Returns the body unchanged when the
 * index does not exist, so a stale click cannot corrupt the document.
 */
export function toggleChecklistItem(body: string, index: number, next?: boolean): string {
  const lines = body.split("\n");
  let seen = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const cr = raw.endsWith("\r") ? "\r" : "";
    const m = ITEM.exec(cr ? raw.slice(0, -1) : raw);
    if (!m) continue;

    seen += 1;
    if (seen !== index) continue;

    const isChecked = m[2] !== " ";
    const target = next ?? !isChecked;
    lines[i] = `${m[1]}${target ? "x" : " "}${m[3]}${m[4] ?? ""}${cr}`;
    return lines.join("\n");
  }

  return body;
}

export interface ChecklistProgress {
  done: number;
  total: number;
}

export function checklistProgress(body: string): ChecklistProgress {
  const items = parseChecklist(body);
  return { done: items.filter((i) => i.checked).length, total: items.length };
}

/**
 * One criterion is one line. Line breaks collapse to a space, the ends are trimmed, and a
 * pasted task-list prefix is stripped — a user (or a model) handing over "- [ ] foo" must
 * not produce "- [ ] - [ ] foo". A leading "[x]" without a marker is text and stays.
 */
export function sanitiseCriterionText(raw: string): string {
  const oneLine = raw.replace(/\r\n|\r|\n/g, " ").trim();
  return oneLine.replace(/^[-*+]\s+\[[ xX]\]\s*/, "").trim();
}

export interface AcceptanceRegion {
  /** Line of the heading, or of the first item when there is no heading. */
  start: number;
  /** Line after the last item that belongs to the section. */
  end: number;
  hasHeading: boolean;
}

/**
 * Where the acceptance section is: from the first `Acceptance criteria` heading (any level,
 * any case) to the line after its last item, stopping at the next heading of the same or a
 * higher level. Without a heading the region is the span of task-list items. Null when the
 * body has neither — which is also what tells the writers to create the section.
 *
 * Items are still indexed document-wide by `parseChecklist`; the region only decides where
 * a new item goes and which lines count as "the description".
 */
export function acceptanceRegion(body: string): AcceptanceRegion | null {
  const lines = body.split("\n");

  let headingAt = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = HEADING.exec(stripCr(lines[i] ?? ""));
    if (m) {
      headingAt = i;
      level = (m[1] ?? "##").length;
      break;
    }
  }

  if (headingAt === -1) {
    const itemLines = lines
      .map((l, i) => (ITEM.test(stripCr(l)) ? i : -1))
      .filter((i) => i >= 0);
    const first = itemLines[0];
    const last = itemLines[itemLines.length - 1];
    if (first === undefined || last === undefined) return null;
    return { start: first, end: last + 1, hasHeading: false };
  }

  let end = headingAt + 1;
  for (let i = headingAt + 1; i < lines.length; i += 1) {
    const text = stripCr(lines[i] ?? "");
    const h = ANY_HEADING.exec(text);
    if (h && (h[1] ?? "").length <= level) break;
    if (ITEM.test(text)) end = i + 1;
  }
  return { start: headingAt, end, hasHeading: true };
}

/**
 * The description: everything above the acceptance section, with line endings normalised
 * to LF and the ends trimmed. What the card page renders, and what an enhance replaces.
 */
export function descriptionOf(body: string): string {
  const region = acceptanceRegion(body);
  const head = region ? body.split("\n").slice(0, region.start).join("\n") : body;
  return head.replace(/\r\n?/g, "\n").trim();
}

/**
 * Append one criterion, unticked.
 *
 * Placement, in order of preference: after the section's last item, cloning that item's
 * indentation and marker so a `*   [ ]` list stays a `*   [ ]` list; under an existing
 * heading with exactly one blank line between them; after the last item in a body that has
 * items but no heading (no heading is invented over the user's file); or, when the body has
 * neither, a new section appended at the very end — the only insertion point that leaves
 * every existing byte where it was. Line endings follow the body. Empty text is a no-op.
 */
export function addChecklistItem(body: string, text: string): string {
  const t = sanitiseCriterionText(text);
  if (!t) return body;

  const lines = body.split("\n");
  const region = acceptanceRegion(body);

  if (region) {
    const inRegion = parseChecklist(body).filter(
      (it) => it.line >= region.start && it.line < region.end,
    );
    const last = inRegion[inRegion.length - 1];

    if (last) {
      const raw = lines[last.line] ?? "";
      const m = ITEM.exec(stripCr(raw));
      const prefix = m?.[1] ?? "- [";
      lines.splice(last.line + 1, 0, `${prefix} ] ${t}${crOf(raw)}`);
      return lines.join("\n");
    }

    if (region.hasHeading) {
      const h = region.start;
      const cr = crOf(lines[h] ?? "");
      const item = `- [ ] ${t}${cr}`;
      const next = lines[h + 1];
      const nextIsRealBlank =
        next !== undefined && stripCr(next) === "" && h + 1 < lines.length - 1;

      if (nextIsRealBlank) {
        const following = lines[h + 2];
        const insert =
          following !== undefined && stripCr(following) !== "" ? [item, cr] : [item];
        lines.splice(h + 2, 0, ...insert);
        return lines.join("\n");
      }

      const insert = [cr, item];
      if (next !== undefined && stripCr(next) !== "") insert.push(cr);
      lines.splice(h + 1, 0, ...insert);
      return lines.join("\n");
    }
  }

  const eol = eolOf(body);
  if (body === "") return `${eol}${ACCEPTANCE_HEADING}${eol}${eol}- [ ] ${t}${eol}`;
  const tail = body.endsWith(eol) ? "" : eol;
  const sep = (body + tail).endsWith(eol + eol) ? "" : eol;
  return `${body}${tail}${sep}${ACCEPTANCE_HEADING}${eol}${eol}- [ ] ${t}${eol}`;
}

/**
 * Rewrite the nth item's text. Marker, indentation, tick and line ending stay; the only
 * other change allowed is normalising `]text` to `] text` on that one line. Unchanged text,
 * empty text or a missing index returns the body as it was, so a no-op save writes nothing.
 */
export function replaceChecklistText(body: string, index: number, text: string): string {
  const t = sanitiseCriterionText(text);
  if (!t) return body;

  const lines = body.split("\n");
  let seen = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const m = ITEM.exec(stripCr(raw));
    if (!m) continue;

    seen += 1;
    if (seen !== index) continue;

    if ((m[4] ?? "").trim() === t) return body;
    lines[i] = `${m[1]}${m[2]}] ${t}${crOf(raw)}`;
    return lines.join("\n");
  }

  return body;
}

/**
 * Remove the nth item: exactly one element of the split array goes, so the file's
 * trailing-newline status is preserved either way and the line's own CR leaves with it.
 * Nothing else is tidied — an emptied section keeps its heading and blank lines.
 */
export function removeChecklistItem(body: string, index: number): string {
  const item = parseChecklist(body)[index];
  if (!item) return body;
  const lines = body.split("\n");
  lines.splice(item.line, 1);
  return lines.join("\n");
}

/**
 * Move the nth item by `by` places, clamped to the list. Implemented as adjacent swaps of
 * line content — indentation, marker, tick and text travel together; each position keeps
 * its own line ending. Lines between items are never touched.
 */
export function moveChecklistItem(body: string, index: number, by: number): string {
  const items = parseChecklist(body);
  const n = items.length;
  if (index < 0 || index >= n) return body;
  const target = Math.max(0, Math.min(n - 1, index + by));
  if (target === index) return body;

  const lines = body.split("\n");
  const step = target > index ? 1 : -1;
  let cur = index;
  while (cur !== target) {
    const a = items[cur]?.line;
    const b = items[cur + step]?.line;
    if (a === undefined || b === undefined) return body;
    const ca = stripCr(lines[a] ?? "");
    const cb = stripCr(lines[b] ?? "");
    lines[a] = cb + crOf(lines[a] ?? "");
    lines[b] = ca + crOf(lines[b] ?? "");
    cur += step;
  }
  return lines.join("\n");
}

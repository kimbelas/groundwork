/**
 * Acceptance criteria are markdown task-list items in the card body.
 *
 * They live in the prose rather than in frontmatter on purpose: a criterion is a
 * sentence, it belongs next to the description that motivates it, and it stays useful
 * when the file is opened in Obsidian or read by the CLI.
 *
 * Every function here is pure and preserves the bytes it is not deliberately changing —
 * ticking a box must not reflow, re-indent, or normalise the rest of the card.
 */

/** `- [ ] text`, `* [x] text`, `+ [X] text`, with any leading indentation. */
const ITEM = /^(\s*[-*+]\s+\[)([ xX])(\]\s?)(.*)$/;

export interface ChecklistItem {
  /** Zero-based index among task-list items in this body, in document order. */
  index: number;
  /** Zero-based line number in the body. */
  line: number;
  checked: boolean;
  text: string;
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

import {
  acceptanceRegion,
  addChecklistItem,
  descriptionOf,
  parseChecklist,
  sanitiseCriterionText,
} from "@/lib/checklist";

/**
 * How an AI `update` lands on a card the user has been editing.
 *
 * The old apply path replaced the whole body with the proposal's `body` plus every
 * `acceptance` item written as `- [ ]`. That deleted any criterion the model did not echo
 * back, cleared every tick the user had made, and dropped any prose after the list — the
 * product thesis ("AI proposes, never overwrites") failing one level down, inside the card.
 *
 * The rule now: **the model can only add criteria.** Every existing task line keeps its
 * bytes, its tick and its position. A proposed item that matches an existing one (after
 * normalising case, whitespace and a trailing full stop) is that item — the user's spelling
 * wins. Anything the model returned that matches nothing is appended, unticked. Anything the
 * user wrote that the model left out is kept and reported as such, so the review can say
 * "kept — not in the model's list" and the user can delete it by hand if the model was right.
 *
 * Prose is the opposite, and on purpose: the description above the list is what an
 * enhancement is *for*, and paragraphs have no unit to key on the way lines do. So the
 * description is replaced by the proposal's — but the report carries before and after, and
 * the review shows both, so what is being replaced is on screen before it is accepted.
 *
 * Pure: no filesystem, no React. The apply path and the proposal route call the same
 * function, which is what keeps the review an honest preview of the write.
 */

export type CriterionStatus = "kept" | "kept-omitted" | "added";

export interface CriterionRow {
  text: string;
  checked: boolean;
  status: CriterionStatus;
}

export interface MergeReport {
  /** In the order they will appear in the file. */
  criteria: CriterionRow[];
  description: { before: string; after: string; changed: boolean };
  /** The model put the acceptance heading inside `body`; the body was cut there. */
  bodyTruncatedAtHeading: boolean;
}

/**
 * What the review shows for one `update` card, computed by the proposal route with the same
 * merge the apply will run. `mtimeMs` is the baseline the apply must carry back, so the
 * write happens against the body the review was computed from or not at all.
 */
export interface CardUpdateDiff {
  cardId: number;
  mtimeMs: number;
  /** The card was deleted between the run and the review. */
  missing?: true;
  title?: { before: string; after: string };
  report?: MergeReport;
}

const HEADING_LINE = /^#{1,6}[ \t]+acceptance criteria[ \t]*#*[ \t]*$/i;

/** The identity of a criterion for matching: case, whitespace and a trailing stop do not count. */
export function normaliseCriterion(text: string): string {
  return sanitiseCriterionText(text)
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "")
    .trim();
}

export function mergeCardBody(
  existingBody: string,
  proposed: { body: string; acceptance: string[] },
): { body: string; report: MergeReport } {
  const existing = parseChecklist(existingBody);
  const consumed = new Set<number>();
  const added: string[] = [];
  const addedKeys = new Set<string>();

  for (const raw of proposed.acceptance) {
    const text = sanitiseCriterionText(raw);
    if (!text) continue;
    const key = normaliseCriterion(text);
    const match = existing.findIndex(
      (item, i) => !consumed.has(i) && normaliseCriterion(item.text) === key,
    );
    if (match >= 0) {
      consumed.add(match);
    } else if (!addedKeys.has(key)) {
      addedKeys.add(key);
      added.push(text);
    }
  }

  const criteria: CriterionRow[] = existing.map((item, i) => ({
    text: item.text,
    checked: item.checked,
    status: consumed.has(i) ? "kept" : "kept-omitted",
  }));
  for (const text of added) criteria.push({ text, checked: false, status: "added" });

  // Existing lines are never rewritten: additions go through the same helper the drawer uses.
  let withAdditions = existingBody;
  for (const text of added) withAdditions = addChecklistItem(withAdditions, text);

  // The proposal's body is the description only. A model that copied the list into it would
  // duplicate every criterion after the join, so the body is cut at the heading if present.
  const proposedLines = proposed.body.split(/\r?\n/);
  const cut = proposedLines.findIndex((l) => HEADING_LINE.test(l));
  const bodyTruncatedAtHeading = cut >= 0;
  let after = (bodyTruncatedAtHeading ? proposedLines.slice(0, cut) : proposedLines)
    .join("\n")
    .trim();

  // Compared and reported with LF regardless of the file's endings; written back with the
  // file's own. Otherwise a multi-line description in a CRLF card reads as "changed" when
  // the text is identical, and is reflowed to LF on the way in.
  const lines = withAdditions.split("\n");
  const region = acceptanceRegion(withAdditions);
  const before = descriptionOf(withAdditions);

  // A model that returned no description must not erase one.
  if (!after) after = before;

  const eol = withAdditions.includes("\r\n") ? "\r\n" : "\n";
  const afterOnDisk = after.split("\n").join(eol);
  const head = after ? `${eol}${afterOnDisk}${eol}${eol}` : eol;
  const body = region
    ? `${head}${lines.slice(region.start).join("\n")}`
    : `${eol}${afterOnDisk}${eol}`;

  return {
    body,
    report: {
      criteria,
      description: { before, after, changed: after !== before },
      bodyTruncatedAtHeading,
    },
  };
}

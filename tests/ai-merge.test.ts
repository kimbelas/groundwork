import { describe, expect, it } from "vitest";

import { mergeCardBody, normaliseCriterion } from "@/lib/ai/merge";
import { parseChecklist } from "@/lib/checklist";

const CARD = [
  "",
  "Thin description.",
  "",
  "## Acceptance criteria",
  "",
  "- [x] Hand-written and ticked",
  "- [ ] Hand-written and open",
  "",
  "Notes after the list.",
  "",
].join("\n");

describe("normaliseCriterion", () => {
  it("ignores case, whitespace and a trailing stop", () => {
    expect(normaliseCriterion("  Webhook  handling is idempotent. ")).toBe(
      normaliseCriterion("webhook handling IS idempotent"),
    );
  });

  it("does not ignore words", () => {
    expect(normaliseCriterion("orderFor")).not.toBe(normaliseCriterion("orderfor is called"));
  });
});

describe("mergeCardBody", () => {
  it("keeps a matched criterion with the user's bytes and tick, not the model's spelling", () => {
    const { body, report } = mergeCardBody(CARD, {
      body: "New description.",
      acceptance: ["hand-written and ticked.", "Hand-written and open"],
    });
    expect(body).toContain("- [x] Hand-written and ticked\n");
    expect(body).not.toContain("ticked.");
    expect(report.criteria.map((c) => c.status)).toEqual(["kept", "kept"]);
  });

  it("keeps a criterion the model omitted, in place, and reports it", () => {
    const { body, report } = mergeCardBody(CARD, {
      body: "New description.",
      acceptance: ["Hand-written and open", "Something new"],
    });
    expect(report.criteria).toEqual([
      { text: "Hand-written and ticked", checked: true, status: "kept-omitted" },
      { text: "Hand-written and open", checked: false, status: "kept" },
      { text: "Something new", checked: false, status: "added" },
    ]);
    expect(parseChecklist(body).map((i) => [i.text, i.checked])).toEqual([
      ["Hand-written and ticked", true],
      ["Hand-written and open", false],
      ["Something new", false],
    ]);
  });

  it("appends additions after the last item and preserves prose after the list", () => {
    const { body } = mergeCardBody(CARD, { body: "New description.", acceptance: ["Added one"] });
    expect(body).toBe(
      [
        "",
        "New description.",
        "",
        "## Acceptance criteria",
        "",
        "- [x] Hand-written and ticked",
        "- [ ] Hand-written and open",
        "- [ ] Added one",
        "",
        "Notes after the list.",
        "",
      ].join("\n"),
    );
  });

  it("uses the user's order, not the model's", () => {
    const { body } = mergeCardBody(CARD, {
      body: "x",
      acceptance: ["Hand-written and open", "Hand-written and ticked"],
    });
    expect(parseChecklist(body).map((i) => i.text)).toEqual([
      "Hand-written and ticked",
      "Hand-written and open",
    ]);
  });

  it("consumes one existing match per duplicate and collapses duplicate additions", () => {
    const dup = "## Acceptance criteria\n\n- [ ] same\n- [x] same\n";
    const { report } = mergeCardBody(dup, { body: "", acceptance: ["same", "Same.", "new", "NEW"] });
    expect(report.criteria.map((c) => c.status)).toEqual(["kept", "kept", "added"]);
  });

  it("strips a pasted task prefix from a proposed item", () => {
    const { body } = mergeCardBody(CARD, { body: "x", acceptance: ["- [ ] pasted"] });
    expect(body).toContain("- [ ] pasted\n");
    expect(body).not.toContain("- [ ] - [ ]");
  });

  it("creates the section at the end when the card had none, and replaces the description", () => {
    const { body } = mergeCardBody("\nThin description.\n", {
      body: "Rewritten with specifics.",
      acceptance: ["The described behaviour is observable end to end"],
    });
    expect(body).toBe(
      "\nRewritten with specifics.\n\n## Acceptance criteria\n\n- [ ] The described behaviour is observable end to end\n",
    );
  });

  it("replaces only the description above the list", () => {
    const { report } = mergeCardBody(CARD, { body: "New description.", acceptance: [] });
    expect(report.description).toEqual({
      before: "Thin description.",
      after: "New description.",
      changed: true,
    });
  });

  it("keeps the existing description when the model returned none", () => {
    const { body, report } = mergeCardBody(CARD, { body: "   ", acceptance: [] });
    expect(body).toContain("Thin description.");
    expect(report.description.changed).toBe(false);
  });

  it("cuts a body that contains the heading, and says so", () => {
    const { body, report } = mergeCardBody(CARD, {
      body: "Desc.\n\n## Acceptance criteria\n\n- [ ] smuggled",
      acceptance: ["smuggled"],
    });
    expect(report.bodyTruncatedAtHeading).toBe(true);
    expect(report.description.after).toBe("Desc.");
    expect(body.match(/## Acceptance criteria/g)).toHaveLength(1);
    expect(parseChecklist(body).filter((i) => i.text === "smuggled")).toHaveLength(1);
  });

  it("follows CRLF", () => {
    const crlf = "\r\nDesc.\r\n\r\n## Acceptance criteria\r\n\r\n- [ ] a\r\n";
    const { body } = mergeCardBody(crlf, { body: "New.", acceptance: ["b"] });
    expect(body).toBe("\r\nNew.\r\n\r\n## Acceptance criteria\r\n\r\n- [ ] a\r\n- [ ] b\r\n");
  });

  it("compares a multi-line description across line endings and writes the file's own back", () => {
    const crlf = "\r\nLine one.\r\nLine two.\r\n\r\n## Acceptance criteria\r\n\r\n- [ ] a\r\n";
    const same = mergeCardBody(crlf, { body: "Line one.\nLine two.", acceptance: [] });
    expect(same.report.description.changed).toBe(false);
    expect(same.body).toBe(crlf);

    const changed = mergeCardBody(crlf, { body: "New one.\nNew two.", acceptance: [] });
    expect(changed.body).toBe("\r\nNew one.\r\nNew two.\r\n\r\n## Acceptance criteria\r\n\r\n- [ ] a\r\n");
  });

  it("with no criteria anywhere, is prose alone", () => {
    const { body, report } = mergeCardBody("\nOld.\n", { body: "New.", acceptance: [] });
    expect(body).toBe("\nNew.\n");
    expect(report.criteria).toEqual([]);
  });

  it("the report is exactly what the file will parse to", () => {
    const { body, report } = mergeCardBody(CARD, {
      body: "x",
      acceptance: ["Hand-written and open", "Extra"],
    });
    expect(parseChecklist(body).map((i) => ({ text: i.text, checked: i.checked }))).toEqual(
      report.criteria.map(({ text, checked }) => ({ text, checked })),
    );
  });
});

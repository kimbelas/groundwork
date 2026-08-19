import { describe, expect, it } from "vitest";

import { parseInline } from "@/lib/inline";

/**
 * The tokenizer exists so vault prose — which can come from an AI proposal — is never
 * turned into an HTML string. These tests pin both the formatting it supports and, more
 * importantly, that markup passes through as literal text.
 */

describe("parseInline", () => {
  it("returns plain text unchanged", () => {
    expect(parseInline("just words")).toEqual([{ type: "text", value: "just words" }]);
  });

  it("reads strong emphasis", () => {
    expect(parseInline("**Considered:** options")).toEqual([
      { type: "strong", value: "Considered:" },
      { type: "text", value: " options" },
    ]);
  });

  it("prefers strong over em, so ** is never two empty ems", () => {
    const tokens = parseInline("**bold**");
    expect(tokens).toEqual([{ type: "strong", value: "bold" }]);
  });

  it("reads italics and code", () => {
    expect(parseInline("*maybe* and `code`")).toEqual([
      { type: "em", value: "maybe" },
      { type: "text", value: " and " },
      { type: "code", value: "code" },
    ]);
  });

  it("handles several spans in one line", () => {
    const tokens = parseInline("**a** mid **b**");
    expect(tokens.map((t) => t.type)).toEqual(["strong", "text", "strong"]);
  });

  it("leaves an unterminated marker literal", () => {
    expect(parseInline("**not closed")).toEqual([{ type: "text", value: "**not closed" }]);
    expect(parseInline("a * b")).toEqual([{ type: "text", value: "a * b" }]);
  });

  it("does not span across a newline", () => {
    const tokens = parseInline("**start\nend**");
    expect(tokens.every((t) => t.type === "text")).toBe(true);
  });

  it("passes HTML through as literal text, never as markup", () => {
    // The whole reason this exists: no path from vault prose to raw HTML.
    const tokens = parseInline('<script>alert(1)</script> and <b>bold</b>');
    expect(tokens).toEqual([
      { type: "text", value: '<script>alert(1)</script> and <b>bold</b>' },
    ]);
  });

  it("keeps HTML literal even inside emphasis", () => {
    expect(parseInline("**<img onerror=x>**")).toEqual([
      { type: "strong", value: "<img onerror=x>" },
    ]);
  });

  it("preserves whitespace and newlines in text runs", () => {
    expect(parseInline("a\n\n  b")).toEqual([{ type: "text", value: "a\n\n  b" }]);
  });

  it("handles an empty string", () => {
    expect(parseInline("")).toEqual([]);
  });

  it("rejects an empty span rather than emitting an empty token", () => {
    expect(parseInline("****")).toEqual([{ type: "text", value: "****" }]);
    expect(parseInline("``")).toEqual([{ type: "text", value: "``" }]);
  });

  it("round-trips the log's house format", () => {
    const tokens = parseInline("**Considered:** replacing it; a sync layer.");
    expect(tokens[0]).toEqual({ type: "strong", value: "Considered:" });
    expect(tokens.map((t) => t.value).join("")).toBe(
      "Considered: replacing it; a sync layer.",
    );
  });
});

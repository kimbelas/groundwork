import { describe, expect, it } from "vitest";

import { buildDoc, readData, replaceBody, replaceData, split } from "@/lib/frontmatter";

/**
 * Test 1 of the five that guard against real data loss.
 *
 * The promise being tested: editing one half of a document leaves the other half
 * byte-identical. A YAML round-tripper cannot make that promise, which is why the
 * write path splices verbatim text instead of re-serializing.
 */

const DOC = `---
name: Portal Rebuild
slug: portal-rebuild
stage: shaping
# a comment a YAML round-trip would silently delete
columns: [Intake, Shaping, Build]
created: 2026-08-04
---

The body text.

Second paragraph with  odd   spacing and a trailing space.${" "}
`;

describe("split", () => {
  it("separates frontmatter from body without altering either", () => {
    const { head, body } = split(DOC);
    expect(head + body).toBe(DOC);
    expect(head.startsWith("---\n")).toBe(true);
    expect(head.trimEnd().endsWith("---")).toBe(true);
    expect(body.startsWith("\nThe body text.")).toBe(true);
  });

  it("treats a document with no frontmatter as all body", () => {
    const raw = "# Just markdown\n\nNo frontmatter here.\n";
    expect(split(raw)).toEqual({ head: "", body: raw });
  });

  it("treats unterminated frontmatter as body rather than reinterpreting it", () => {
    const raw = "---\nname: half typed\n\nstill going\n";
    expect(split(raw)).toEqual({ head: "", body: raw });
  });

  it("handles CRLF documents", () => {
    const raw = "---\r\nname: Windows\r\n---\r\nBody line\r\n";
    const { head, body } = split(raw);
    expect(head).toBe("---\r\nname: Windows\r\n---\r\n");
    expect(body).toBe("Body line\r\n");
  });

  it("keeps a BOM with the head", () => {
    const raw = "﻿---\nname: Bommed\n---\nBody\n";
    const { head, body } = split(raw);
    expect(head.startsWith("﻿")).toBe(true);
    expect(head + body).toBe(raw);
  });
});

describe("replaceBody", () => {
  it("leaves the frontmatter block byte-identical, comments included", () => {
    const before = split(DOC).head;
    const next = replaceBody(DOC, "\nCompletely different body.\n");
    expect(split(next).head).toBe(before);
    expect(next).toContain("# a comment a YAML round-trip would silently delete");
    expect(next).not.toContain("Second paragraph");
  });

  it("can write a body onto a document that had none", () => {
    expect(replaceBody("---\na: 1\n---\n", "hello")).toBe("---\na: 1\n---\nhello");
  });
});

describe("replaceData", () => {
  it("leaves the body byte-identical", () => {
    const before = split(DOC).body;
    const next = replaceData(DOC, { name: "Renamed", slug: "portal-rebuild" });
    expect(split(next).body).toBe(before);
  });

  it("writes the new values", () => {
    const next = replaceData(DOC, { name: "Renamed", stage: "building" });
    const data = readData(next);
    expect(data.name).toBe("Renamed");
    expect(data.stage).toBe("building");
  });

  it("preserves CRLF when the original used it", () => {
    const raw = "---\r\nname: Windows\r\n---\r\nBody line\r\n";
    const next = replaceData(raw, { name: "Still Windows" });
    expect(next).toContain("\r\n");
    expect(next.endsWith("Body line\r\n")).toBe(true);
    expect(split(next).body).toBe("Body line\r\n");
  });
});

describe("readData", () => {
  it("returns an empty object when there is no frontmatter", () => {
    expect(readData("# nothing\n")).toEqual({});
  });

  it("returns an empty object rather than throwing on malformed YAML", () => {
    expect(readData("---\n  : : :\nbad\n---\nbody\n")).toEqual({});
  });
});

describe("buildDoc", () => {
  it("round-trips through split", () => {
    const doc = buildDoc({ name: "New", slug: "new" }, "Body here\n");
    expect(split(doc).body).toBe("Body here\n");
    expect(readData(doc).slug).toBe("new");
  });
});

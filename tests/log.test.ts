import { describe, expect, it } from "vitest";

import { formatDecision, parseLog } from "@/lib/log";

const LOG = `## 2026-08-14 — Keep the 2014 work order system

**Considered:** replacing it; a sync layer; integrating directly.

**Because:** the client was unambiguous that it is not going away.

## 2026-08-08 — Phased cutover by building

**Because:** it keeps the blast radius to one super.
`;

describe("parseLog", () => {
  it("reads entries newest-first, as written", () => {
    const entries = parseLog(LOG);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.date).toBe("2026-08-14");
    expect(entries[0]?.title).toBe("Keep the 2014 work order system");
    expect(entries[1]?.date).toBe("2026-08-08");
  });

  it("keeps the body verbatim", () => {
    const entries = parseLog(LOG);
    expect(entries[0]?.body).toContain("**Considered:** replacing it");
    expect(entries[0]?.body).toContain("**Because:** the client was unambiguous");
    // The next heading is not swept into the previous body.
    expect(entries[0]?.body).not.toContain("Phased cutover");
  });

  it("handles a heading with no date", () => {
    const entries = parseLog("## Just a title\n\nSome body.\n");
    expect(entries[0]?.date).toBeNull();
    expect(entries[0]?.title).toBe("Just a title");
  });

  it("accepts an en dash, a hyphen, or nothing after the date", () => {
    expect(parseLog("## 2026-01-01 – Dash\n")[0]?.title).toBe("Dash");
    expect(parseLog("## 2026-01-01 - Hyphen\n")[0]?.title).toBe("Hyphen");
    expect(parseLog("## 2026-01-01 Plain\n")[0]?.title).toBe("Plain");
  });

  it("returns nothing for an empty log", () => {
    expect(parseLog("")).toEqual([]);
    expect(parseLog("\n\n")).toEqual([]);
  });

  it("ignores prose before the first heading", () => {
    expect(parseLog("Loose text.\n\n## 2026-01-01 — Real\n")).toHaveLength(1);
  });

  it("does not treat a level-3 heading as an entry", () => {
    const entries = parseLog("## 2026-01-01 — One\n\n### Sub heading\n\nbody\n");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.body).toContain("### Sub heading");
  });

  it("handles CRLF", () => {
    const entries = parseLog("## 2026-01-01 — One\r\n\r\nbody\r\n");
    expect(entries[0]?.title).toBe("One");
    expect(entries[0]?.body).toBe("body");
  });
});

describe("formatDecision", () => {
  it("renders the house format", () => {
    const out = formatDecision({
      date: "2026-08-19",
      title: "Use the CLI, not the API",
      considered: "the API with a key; the CLI",
      because: "no key to manage and it rides the subscription",
    });

    expect(out.split("\n")[0]).toBe("## 2026-08-19 — Use the CLI, not the API");
    expect(out).toContain("**Considered:** the API with a key; the CLI");
    expect(out).toContain("**Because:** no key to manage");
  });

  it("round-trips through the parser", () => {
    const out = formatDecision({
      date: "2026-08-19",
      title: "A decision",
      considered: "x; y",
      because: "z",
    });
    const parsed = parseLog(out);
    expect(parsed[0]?.date).toBe("2026-08-19");
    expect(parsed[0]?.title).toBe("A decision");
  });

  it("omits empty sections rather than leaving stubs", () => {
    const out = formatDecision({
      date: "2026-08-19",
      title: "Minimal",
      considered: "",
      because: "",
    });
    expect(out).toBe("## 2026-08-19 — Minimal");
  });

  it("trims stray whitespace from every field", () => {
    const out = formatDecision({
      date: "2026-08-19",
      title: "  Spaced  ",
      considered: "  a  ",
      because: "  b  ",
    });
    expect(out).toContain("— Spaced");
    expect(out).toContain("**Considered:** a");
  });
});

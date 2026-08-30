import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finding a card by its number.
 *
 * The card id was always permanent — `lib/vault.ts` never reuses one, even after a card is
 * trashed — but nothing could look one up. The number is what somebody writes on a slip of
 * paper at a counter, so typing it back in has to be the fastest route there is, including
 * for a bare single digit that the text search rightly refuses as too short to scan a vault
 * for.
 */

let dir: string;
let vault: typeof import("@/lib/vault");

function projectDoc(slug: string, name: string): string {
  return `---
name: ${name}
slug: ${slug}
stage: shaping
health: green
archetype: internal-tool
columns: [Backlog, Done]
created: 2026-08-29
updated: 2026-08-29
---

A brief mentioning #7 in passing, as prose.
`;
}

function cardDoc(id: number, title: string): string {
  return `---
id: ${id}
title: ${title}
column: Backlog
phase: 1
priority: P2
size: M
confidence: 0.5
blocked: false
order: ${id * 100}
created: 2026-08-29
updated: 2026-08-29
---

Body text for ${title}.
`;
}

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, contents, "utf8");
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-ticket-"));
  process.env.GROUNDWORK_VAULT = dir;
  vi.resetModules();
  vault = await import("@/lib/vault");

  await write("alpha/project.md", projectDoc("alpha", "Alpha"));
  await write("alpha/cards/0007-billing.md", cardDoc(7, "Billing API"));
  await write("alpha/cards/0012-auth.md", cardDoc(12, "Auth spike"));

  await write("beta/project.md", projectDoc("beta", "Beta"));
  await write("beta/cards/0007-other.md", cardDoc(7, "Another seven"));
});

afterEach(async () => {
  delete process.env.GROUNDWORK_VAULT;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("searching by card number", () => {
  it("finds the card for #7", async () => {
    const hits = await vault.searchVault("#7");
    const cards = hits.filter((h) => h.where === "Card");

    expect(cards.map((h) => h.href)).toContain("/p/alpha/cards/7");
    expect(cards.find((h) => h.slug === "alpha")?.line).toContain("Billing API");
  });

  it("finds it from a bare number the text search would refuse", async () => {
    /*
     * The case the ticket lookup exists for. `searchVault` requires two characters before it
     * scans anything, which is right for prose and wrong for an identifier: `7` is not a
     * vague query, it is an exact one.
     */
    const hits = await vault.searchVault("7");
    expect(hits.filter((h) => h.where === "Card").map((h) => h.href)).toContain(
      "/p/alpha/cards/7",
    );
  });

  it("returns the same number in every project, named so they can be told apart", async () => {
    // Ids are per project, so #7 legitimately exists more than once. Both are answers.
    const cards = (await vault.searchVault("#7")).filter((h) => h.where === "Card");

    expect(cards).toHaveLength(2);
    expect(cards.map((h) => h.projectName).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("tolerates a space after the hash", async () => {
    const cards = (await vault.searchVault("# 7")).filter((h) => h.where === "Card");
    expect(cards.map((h) => h.slug).sort()).toEqual(["alpha", "beta"]);
  });

  it("puts exact card matches before prose that merely mentions the number", async () => {
    /*
     * Both briefs contain the literal "#7". The card is what was asked for; the sentence is
     * a coincidence, and a coincidence must not outrank an identifier.
     */
    const hits = await vault.searchVault("#7");

    expect(hits[0]?.where).toBe("Card");
    expect(hits.some((h) => h.where === "Brief")).toBe(true);
  });

  it("still searches text for a query that only looks numeric", async () => {
    // No card 2026 anywhere, so this has to fall through rather than answer "nothing".
    const hits = await vault.searchVault("2026");
    expect(hits.filter((h) => h.where === "Card")).toHaveLength(0);
  });

  it("finds nothing for a number no card has, without throwing", async () => {
    expect(await vault.searchVault("#999")).toEqual([]);
  });

  it("does not read a long digit string as a ticket", async () => {
    // Seven digits is past the guard, so it is a text query like any other.
    expect(await vault.searchVault("1234567")).toEqual([]);
  });

  it("leaves ordinary text search alone", async () => {
    const hits = await vault.searchVault("Billing");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.line.length > 0)).toBe(true);
  });
});

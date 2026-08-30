import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `DELETE /api/vault/[slug]`, exercised through the exported handler.
 *
 * The vault function has its own suite; this one is about the things only the route does,
 * and both of them are guards. `CLAUDE.md`: *"A guard needs a test at its call site, not
 * only on its function."* A review once replaced a call to `assertInstructionScoped` with
 * `void assertInstructionScoped;` and the whole suite stayed green, because every test
 * checked the guard and none checked that it was installed. So:
 *
 *  - the AI-run refusal is asserted here, not in `lib/vault.ts`, because that is where it
 *    lives and a vault-level test could not tell whether the route still calls it;
 *  - the cross-site refusal is asserted here too, because `{ mutating: true }` is a flag
 *    someone can drop while every other test keeps passing.
 */

let dir: string;
let runs: string;
let route: typeof import("@/app/api/vault/[slug]/route");
let runsLib: typeof import("@/lib/runs");

const PROJECT = `---
name: Alpha
slug: alpha
stage: shaping
health: green
archetype: client
columns: [Intake, Shaping, Done]
created: 2026-08-01
updated: 2026-08-01
---

A brief.
`;

const CARD_DOC = `---
id: 1
title: First
---

Body.
`;

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, contents, "utf8");
}

async function exists(rel: string): Promise<boolean> {
  return fsp
    .stat(path.join(dir, rel))
    .then(() => true)
    .catch(() => false);
}

async function projectMtime(slug: string): Promise<number> {
  const st = await fsp.stat(path.join(dir, slug, "project.md"));
  return st.mtimeMs;
}

/** A same-origin browser request, which is what the mutating guards expect to see. */
function del(slug: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:4848/api/vault/${slug}`, {
    method: "DELETE",
    headers: {
      host: "127.0.0.1:4848",
      origin: "http://127.0.0.1:4848",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function ctx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

/** Plant a lock held by a run against `slug`, the way a live synthesis would. */
async function holdLock(slug: string): Promise<void> {
  const runId = runsLib.makeRunId();
  await runsLib.createRun({
    runId,
    slug,
    job: "synthesize",
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  expect(runsLib.acquireLock(runId)).toBe(true);
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-delroute-"));
  runs = path.join(dir, "__runs", "runs");
  process.env.GROUNDWORK_VAULT = dir;
  // Without this the lock and run records would land in the real .groundwork/ of the repo.
  process.env.GROUNDWORK_RUNS = runs;

  vi.resetModules();
  route = await import("@/app/api/vault/[slug]/route");
  runsLib = await import("@/lib/runs");

  await write("alpha/project.md", PROJECT);
  await write("alpha/cards/0001-first.md", CARD_DOC);
});

afterEach(async () => {
  delete process.env.GROUNDWORK_VAULT;
  delete process.env.GROUNDWORK_RUNS;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("DELETE /api/vault/[slug]", () => {
  it("trashes the project and reports where it went", async () => {
    const res = await route.DELETE(del("alpha", { expectedMtimeMs: await projectMtime("alpha") }), ctx("alpha"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { trashedTo: string };
    expect(body.trashedTo.startsWith(".trash/alpha-")).toBe(true);
    expect(await exists("alpha")).toBe(false);
  });

  it("refuses while an AI run holds this project, and keeps the project", async () => {
    const mtime = await projectMtime("alpha");
    await holdLock("alpha");

    const res = await route.DELETE(del("alpha", { expectedMtimeMs: mtime }), ctx("alpha"));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("conflict");
    expect(body.error).toMatch(/AI run/i);
    expect(await exists("alpha/project.md")).toBe(true);
  });

  it("ignores a run that belongs to a different project", async () => {
    const mtime = await projectMtime("alpha");
    await holdLock("beta");

    const res = await route.DELETE(del("alpha", { expectedMtimeMs: mtime }), ctx("alpha"));

    expect(res.status).toBe(200);
    expect(await exists("alpha")).toBe(false);
  });

  it("refuses a stale precondition", async () => {
    const stale = await projectMtime("alpha");
    await new Promise((r) => setTimeout(r, 12));
    await write("alpha/project.md", PROJECT.replace("A brief.", "Edited elsewhere."));

    const res = await route.DELETE(del("alpha", { expectedMtimeMs: stale }), ctx("alpha"));

    expect(res.status).toBe(409);
    expect(await exists("alpha/project.md")).toBe(true);
  });

  it("requires the precondition rather than defaulting it", async () => {
    const res = await route.DELETE(del("alpha", {}), ctx("alpha"));

    expect(res.status).toBe(422);
    expect(await exists("alpha/project.md")).toBe(true);
  });

  it("rejects a cross-site delete, proving the mutating guards are installed", async () => {
    const mtime = await projectMtime("alpha");

    const res = await route.DELETE(
      del("alpha", { expectedMtimeMs: mtime }, { "sec-fetch-site": "cross-site" }),
      ctx("alpha"),
    );

    expect(res.status).toBe(400);
    expect(await exists("alpha/project.md")).toBe(true);
  });
});

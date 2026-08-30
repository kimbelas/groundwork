import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/vault` when a repository is what you have instead of a name.
 *
 * The guarantee worth a suite of its own is the *ordering*: the repository is validated
 * before the project is created. Creating first would leave a real, empty folder in the
 * vault every time someone pastes a path with a typo in it — a project that exists, was
 * never asked for, and now has to be deleted. Several tests below assert the absence of
 * that folder rather than only the error, because the error was never the hard part.
 */

let vault: string;
let scratch: string;
let repoDir: string;
let route: typeof import("@/app/api/vault/route");

function post(body: unknown): Request {
  return new Request("http://127.0.0.1:4848/api/vault", {
    method: "POST",
    headers: {
      host: "127.0.0.1:4848",
      origin: "http://127.0.0.1:4848",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * `route()` types its handler as `(req, ctx)`. This route has no dynamic segment, so
 * `Ctx` infers as `unknown` and the second argument still has to be passed - Next hands
 * it `undefined`. Omitting it is a type error and not a runtime one, so the tests ran
 * green while `tsc` was failing; this wrapper keeps the two agreeing.
 */
async function create(body: unknown): Promise<Response> {
  return route.POST(post(body), undefined);
}

async function vaultEntries(): Promise<string[]> {
  return (await fsp.readdir(vault).catch(() => [] as string[])).sort();
}

async function frontmatter(slug: string): Promise<string> {
  return fsp.readFile(path.join(vault, slug, "project.md"), "utf8");
}

beforeEach(async () => {
  // Two sibling temp trees, never nested: `validateRepoPath` refuses a repo inside the
  // vault, and a nested fixture would be testing that rule instead of this one.
  vault = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-create-vault-"));
  scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "gw-create-repo-"));
  repoDir = path.join(scratch, "tenant-portal");
  await fsp.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fsp.writeFile(path.join(repoDir, "src", "index.ts"), "export const x = 1;\n", "utf8");

  process.env.GROUNDWORK_VAULT = vault;
  vi.resetModules();
  route = await import("@/app/api/vault/route");
});

afterEach(async () => {
  delete process.env.GROUNDWORK_VAULT;
  await fsp.rm(vault, { recursive: true, force: true });
  await fsp.rm(scratch, { recursive: true, force: true });
});

describe("POST /api/vault from a repository", () => {
  it("names the project after the folder and connects the repo in one write", async () => {
    const res = await create({ repo: repoDir });

    expect(res.status).toBe(201);
    const meta = (await res.json()) as { slug: string; name: string; repo?: string };
    expect(meta.slug).toBe("tenant-portal");
    expect(meta.name).toBe("Tenant Portal");

    // Connected on the way in, not patched on afterwards: the first bytes on disk already
    // carry it, so there is no window where the project exists unattached.
    const doc = await frontmatter("tenant-portal");
    expect(doc).toContain("name: Tenant Portal");
    expect(doc).toMatch(/^repo: /m);
    expect(meta.repo).toBe(await fsp.realpath(repoDir));
  });

  it("falls back to the default archetype rather than asking", async () => {
    await create({ repo: repoDir });
    expect(await frontmatter("tenant-portal")).toContain("archetype: internal-tool");
  });

  it("accepts a path wrapped in quotes, the way Explorer copies it", async () => {
    /*
     * "Copy as path" is the one gesture that hands someone an absolute path without typing
     * it, and it produces `"C:\...\repo"`. Before the quotes were stripped this failed with
     * a message about relative paths — true of the string, useless to the reader.
     */
    const res = await create({ repo: `"${repoDir}"` });

    expect(res.status).toBe(201);
    expect(await vaultEntries()).toEqual(["tenant-portal"]);
  });

  it("creates nothing when the path does not exist", async () => {
    const missing = path.join(scratch, "no-such-repo");
    const res = await create({ repo: missing });

    expect(res.status).toBe(400);
    // The point of the whole ordering. A typo must not leave a folder behind.
    expect(await vaultEntries()).toEqual([]);
  });

  it("creates nothing when the path is a file rather than a directory", async () => {
    const file = path.join(repoDir, "src", "index.ts");
    const res = await create({ repo: file });

    expect(res.status).toBe(400);
    expect(await vaultEntries()).toEqual([]);
  });

  it("creates nothing when the path is relative", async () => {
    const res = await create({ repo: "./somewhere" });

    expect(res.status).toBe(400);
    expect(await vaultEntries()).toEqual([]);
  });

  it("refuses a repository inside the vault, and leaves the vault empty", async () => {
    const inside = path.join(vault, "not-a-repo");
    await fsp.mkdir(inside, { recursive: true });

    const res = await create({ repo: inside });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/inside the vault/i);
    // The directory that was already there survives; nothing new is added beside it.
    expect(await vaultEntries()).toEqual(["not-a-repo"]);
  });

  it("prefers an explicit name over the folder's", async () => {
    const res = await create({ repo: repoDir, name: "Something Else" });

    expect(res.status).toBe(201);
    const meta = (await res.json()) as { slug: string; name: string };
    expect(meta.name).toBe("Something Else");
    expect(meta.slug).toBe("something-else");
  });

  it("still refuses a body with neither a name nor a repository", async () => {
    const res = await create({ archetype: "client" });

    expect(res.status).toBe(422);
    expect(await vaultEntries()).toEqual([]);
  });

  it("still creates a blank project from a name alone", async () => {
    // The existing path through this route has to keep working unchanged.
    const res = await create({ name: "Plain Project", archetype: "client" });

    expect(res.status).toBe(201);
    const doc = await frontmatter("plain-project");
    expect(doc).toContain("archetype: client");
    expect(doc).not.toMatch(/^repo: /m);
  });

  it("reports a duplicate rather than merging into the existing folder", async () => {
    await create({ repo: repoDir });
    const again = await create({ repo: repoDir });

    expect(again.status).toBe(409);
    const body = (await again.json()) as { code: string };
    expect(body.code).toBe("already_exists");
  });
});

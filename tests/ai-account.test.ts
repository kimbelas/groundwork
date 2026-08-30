import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseAuthStatus } from "@/lib/ai/account";

/**
 * The account check is asked of the CLI, never read off disk. These pin the parser's three
 * duties: say which state, forward only the whitelisted fields, and never throw on garbage.
 */
describe("parseAuthStatus", () => {
  it("reads a signed-in answer and forwards only the fields the UI shows", () => {
    const out = JSON.stringify({
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      email: "someone@example.com",
      orgId: "org-uuid",
      orgName: "Example Org",
      subscriptionType: "team",
      accessToken: "sk-should-never-leave",
    });
    const status = parseAuthStatus(out, 0);
    expect(status).toEqual({
      state: "connected",
      email: "someone@example.com",
      orgName: "Example Org",
      subscriptionType: "team",
      authMethod: "claude.ai",
    });
    expect(JSON.stringify(status)).not.toContain("sk-should-never-leave");
    expect(JSON.stringify(status)).not.toContain("org-uuid");
  });

  it("is signed-out when the CLI says so, whatever the exit code", () => {
    expect(parseAuthStatus(JSON.stringify({ loggedIn: false }), 1)).toEqual({
      state: "signed-out",
    });
  });

  it("is unknown, with a reason, for anything it cannot read", () => {
    expect(parseAuthStatus("not json", 0)).toMatchObject({ state: "unknown" });
    expect(parseAuthStatus("", 1)).toMatchObject({ state: "unknown", detail: /code 1/ });
    expect(parseAuthStatus(JSON.stringify({ hello: 1 }), 0)).toMatchObject({ state: "unknown" });
  });

  it("tolerates missing optional fields on a signed-in answer", () => {
    expect(parseAuthStatus(JSON.stringify({ loggedIn: true }), 0)).toEqual({
      state: "connected",
      email: null,
      orgName: null,
      subscriptionType: null,
      authMethod: null,
    });
  });
});

describe("cliAccount", () => {
  const saved = { cmd: process.env.GROUNDWORK_CLAUDE_CMD, engine: process.env.GROUNDWORK_AI_ENGINE };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (saved.cmd === undefined) delete process.env.GROUNDWORK_CLAUDE_CMD;
    else process.env.GROUNDWORK_CLAUDE_CMD = saved.cmd;
    if (saved.engine === undefined) delete process.env.GROUNDWORK_AI_ENGINE;
    else process.env.GROUNDWORK_AI_ENGINE = saved.engine;
  });

  it("never spawns under the fixture engine", async () => {
    process.env.GROUNDWORK_AI_ENGINE = "fixture";
    process.env.GROUNDWORK_CLAUDE_CMD = "C:\\definitely\\not\\here\\claude.cmd";
    const { cliAccount } = await import("@/lib/ai/account");
    expect(await cliAccount()).toEqual({ state: "fixture" });
  });

  it("reports the path it looked at when the CLI is not there", async () => {
    delete process.env.GROUNDWORK_AI_ENGINE;
    const looked = "C:\\definitely\\not\\here\\claude.cmd";
    process.env.GROUNDWORK_CLAUDE_CMD = looked;
    const { cliAccount } = await import("@/lib/ai/account");
    const status = await cliAccount({ refresh: true });
    expect(status).toEqual({ state: "missing", looked });
  }, 20_000);
});

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { VaultError } from "@/lib/errors";
import { assertTrustedRequest, errorResponse, readJson } from "@/lib/http";

/**
 * The request boundary. There is no login — it is a single-user loopback app — so
 * these guards are the entire boundary between a random browser tab and the vault.
 */

function req(url: string, headers: Record<string, string> = {}, body?: string): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "PATCH",
    headers: { host: new URL(url).host, ...headers },
    ...(body === undefined ? {} : { body }),
  });
}

describe("assertTrustedRequest", () => {
  const URL_OK = "http://127.0.0.1:4848/api/vault/x";

  it("allows a same-origin browser request", () => {
    expect(() =>
      assertTrustedRequest(
        req(URL_OK, { "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:4848" }),
      ),
    ).not.toThrow();
  });

  it("allows a non-browser client that claims no origin", () => {
    expect(() => assertTrustedRequest(req(URL_OK))).not.toThrow();
  });

  it("rejects a cross-site request (CSRF from any open tab)", () => {
    expect(() =>
      assertTrustedRequest(req(URL_OK, { "sec-fetch-site": "cross-site" })),
    ).toThrow(/Cross-site/);
  });

  it("rejects same-site-but-not-same-origin", () => {
    expect(() => assertTrustedRequest(req(URL_OK, { "sec-fetch-site": "same-site" }))).toThrow();
  });

  it("rejects a mismatched Origin even when Sec-Fetch-Site is absent", () => {
    expect(() => assertTrustedRequest(req(URL_OK, { origin: "http://evil.example" }))).toThrow(
      /does not match/,
    );
  });

  it("rejects a malformed Origin rather than ignoring it", () => {
    expect(() => assertTrustedRequest(req(URL_OK, { origin: "not a url" }))).toThrow(/Malformed/);
  });

  it("allows an Origin matching the Host even when req.url was normalised elsewhere", () => {
    // Regression: Next rewrites req.url to the canonical dev host, so a browser on
    // 127.0.0.1 produced req.url "http://localhost:4848/...". Comparing Origin against
    // req.url rejected every legitimate write in the app, not only in tests.
    const normalised = new Request("http://localhost:4848/api/vault/x", {
      method: "PATCH",
      headers: {
        host: "127.0.0.1:4848",
        origin: "http://127.0.0.1:4848",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(() => assertTrustedRequest(normalised)).not.toThrow();
  });

  it("still rejects a foreign Origin when req.url was normalised", () => {
    const spoofed = new Request("http://localhost:4848/api/vault/x", {
      method: "PATCH",
      headers: { host: "127.0.0.1:4848", origin: "http://evil.example" },
    });
    expect(() => assertTrustedRequest(spoofed)).toThrow(/does not match host/);
  });

  it("rejects a request with no Host header at all", () => {
    const headerless = new Request("http://127.0.0.1:4848/api/vault/x");
    headerless.headers.delete("host");
    expect(() => assertTrustedRequest(headerless)).toThrow();
  });

  it("rejects a non-loopback Host, which is what DNS rebinding produces", () => {
    // The browser has resolved attacker.example to 127.0.0.1, so the socket reaches us,
    // but the request still carries the attacker's hostname.
    const rebound = new Request("http://attacker.example/api/vault/x", {
      headers: { host: "attacker.example" },
    });
    expect(() => assertTrustedRequest(rebound)).toThrow(/loopback only/);
  });

  it("accepts every loopback spelling", () => {
    for (const host of ["127.0.0.1:4848", "localhost:4848"]) {
      const r = new Request(`http://${host}/api/vault/x`, { headers: { host } });
      expect(() => assertTrustedRequest(r), host).not.toThrow();
    }
  });
});

describe("readJson", () => {
  const Schema = z.object({ name: z.string() });
  const URL_OK = "http://127.0.0.1:4848/api/vault/x";

  it("returns parsed data", async () => {
    await expect(readJson(req(URL_OK, {}, '{"name":"ok"}'), Schema)).resolves.toEqual({
      name: "ok",
    });
  });

  it("rejects invalid JSON with a typed error", async () => {
    await expect(readJson(req(URL_OK, {}, "{nope"), Schema)).rejects.toMatchObject({
      code: "invalid_document",
    });
  });

  it("rejects a body that fails the schema", async () => {
    await expect(readJson(req(URL_OK, {}, '{"name":42}'), Schema)).rejects.toMatchObject({
      code: "invalid_document",
    });
  });

  it("rejects an oversized body before parsing it", async () => {
    const huge = JSON.stringify({ name: "x".repeat(3_000_000) });
    await expect(readJson(req(URL_OK, {}, huge), Schema)).rejects.toThrow(/too large/);
  });

  it("rejects a declared content-length over the cap", async () => {
    await expect(
      readJson(req(URL_OK, { "content-length": "9999999" }, '{"name":"ok"}'), Schema),
    ).rejects.toThrow(/too large/);
  });
});

describe("errorResponse", () => {
  it("maps a conflict to 409 with its message", async () => {
    const res = errorResponse(new VaultError("conflict", "changed on disk"));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "changed on disk", code: "conflict" });
  });

  it("maps an invalid slug to 400", () => {
    expect(errorResponse(new VaultError("invalid_slug", "bad")).status).toBe(400);
  });

  it("never leaks an unexpected error's detail to the client", async () => {
    const res = errorResponse(new Error("ENOENT: C:\\Users\\belas\\secret\\path"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Something went wrong.");
    expect(JSON.stringify(body)).not.toContain("belas");
  });
});

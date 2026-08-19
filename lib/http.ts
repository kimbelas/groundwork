import { z } from "zod";

import { VaultError, isVaultError } from "./errors";

/**
 * Shared route-handler plumbing: request authentication, body parsing, error mapping.
 *
 * There is no login here, and that is deliberate — it is a single-user app on
 * loopback. But "no auth" is not the same as "no boundary": this process writes files,
 * and any web page the user has open can issue requests to 127.0.0.1. The guards below
 * are what stand between a random tab and the vault.
 */

const MAX_BODY_BYTES = 2_000_000; // a brief is prose; 2 MB is already absurd

/**
 * Reject cross-site writes.
 *
 * Two real attacks this closes on a localhost app:
 *
 *  - **CSRF.** Any page in the browser can `fetch("http://127.0.0.1:4848/api/...")`.
 *    Without a check, a background tab could rewrite the vault.
 *  - **DNS rebinding.** An attacker's domain re-resolves to 127.0.0.1, making the
 *    browser treat their origin as same-origin with ours. Pinning the Host header to
 *    a loopback literal defeats it, because the rebound request still carries the
 *    attacker's hostname.
 *
 * `Sec-Fetch-Site` is sent by every current browser and cannot be forged by page
 * script. Requests without it (curl, tests) are allowed only when no Origin claims
 * otherwise — a non-browser client is not the threat model here.
 */
export function assertTrustedRequest(req: Request): void {
  const host = req.headers.get("host") ?? "";
  if (!host) {
    throw new VaultError("escapes_root", "Request has no Host header");
  }
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (!LOOPBACK.has(hostname)) {
    throw new VaultError(
      "escapes_root",
      `Refusing a request addressed to "${host}". Groundwork serves loopback only.`,
    );
  }

  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new VaultError("escapes_root", `Cross-site request rejected (${site}).`);
  }

  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new VaultError("escapes_root", "Malformed Origin header");
    }
    /*
     * Compared against the Host header, NOT `new URL(req.url).host`.
     *
     * Next normalises `req.url` to the canonical dev host, so a browser pointed at
     * 127.0.0.1:4848 arrives with Origin "http://127.0.0.1:4848" and a req.url of
     * "http://localhost:4848/...". Comparing to req.url rejected every legitimate
     * write. The Host header is what the browser actually addressed, and the loopback
     * check above has already constrained it.
     */
    if (originHost !== host) {
      throw new VaultError("escapes_root", `Origin ${origin} does not match host ${host}`);
    }
  }
}

/**
 * Parse and validate a JSON body.
 *
 * Size is capped before parsing: an unbounded `await req.json()` on a route that then
 * writes to disk is a trivial way to exhaust memory.
 */
export async function readJson<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<z.output<T>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new VaultError("invalid_document", "Request body is too large");
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new VaultError("invalid_document", "Request body is too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VaultError("invalid_document", "Body is not valid JSON");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new VaultError(
      "invalid_document",
      result.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    );
  }
  return result.data;
}

export interface ApiErrorBody {
  error: string;
  code: string;
}

/**
 * Map a thrown value to a Response.
 *
 * Typed VaultErrors carry their own status and a message written for a human. Anything
 * else is a bug: log it server-side, return a generic 500, and never leak a stack or a
 * filesystem path to the client.
 */
export function errorResponse(e: unknown): Response {
  if (isVaultError(e)) {
    return Response.json({ error: e.message, code: e.code } satisfies ApiErrorBody, {
      status: e.status,
    });
  }

  console.error("[groundwork] unhandled route error:", e);
  return Response.json({ error: "Something went wrong.", code: "internal" } satisfies ApiErrorBody, {
    status: 500,
  });
}

/** Wrap a handler so every route gets the same guards and the same error shape. */
export function route<Ctx>(
  handler: (req: Request, ctx: Ctx) => Promise<Response>,
  opts: { mutating?: boolean } = {},
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      if (opts.mutating) assertTrustedRequest(req);
      return await handler(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

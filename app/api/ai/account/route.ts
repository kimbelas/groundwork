import { accountContext, cliAccount } from "@/lib/ai/account";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Which Claude account the CLI is signed into, from the CLI itself. GET serves the
 * one-minute cache. Asking again is a POST behind the mutating guard: a refresh spawns a
 * process, and a plain GET can be fired at 127.0.0.1 by any page in the browser - two
 * hundred of them would be two hundred CLI processes on the user's machine. The cache and
 * the shared in-flight probe bound the GET; the boundary bounds the refresh.
 */
export const GET = route(async () => {
  return Response.json({ account: await cliAccount(), ...accountContext() });
});

export const POST = route(
  async () => {
    return Response.json({ account: await cliAccount({ refresh: true }), ...accountContext() });
  },
  { mutating: true },
);

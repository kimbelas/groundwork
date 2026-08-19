/**
 * When an unconfirmed local value should still be shown, and when the server takes over.
 *
 * The rule this app already follows is that the server is the source of truth and a
 * component holds only *overrides* — never a copy of server data, because `useState`
 * ignores a changed initial value and the component then freezes at first render.
 *
 * That leaves one question with a non-obvious answer: when does an override stop applying?
 *
 * Dropping it as soon as the server agrees is the usual answer, and it is not enough. The
 * override lingers in state, and if the server later moves to a *third* value — someone
 * editing the vault in Obsidian, an applied AI proposal — the stale override reapplies and
 * masks it. The control then shows a value that is no longer in the file, confidently.
 *
 * So an override is valid only while the server still shows what it was written over. The
 * instant the server moves at all, in any direction, it wins.
 */

export interface Optimistic<T> {
  /** What the user chose, not yet confirmed. */
  value: T;
  /** What the server held when the write started. */
  base: T;
}

/**
 * The value to render.
 *
 * `pending` is undefined when nothing is in flight, which is the common case.
 */
export function resolveOptimistic<T>(server: T, pending: Optimistic<T> | undefined): T {
  if (!pending) return server;
  // Still waiting: the server has not moved, so keep showing the optimistic value rather
  // than flashing back to the old one while the round trip completes.
  return Object.is(server, pending.base) ? pending.value : server;
}

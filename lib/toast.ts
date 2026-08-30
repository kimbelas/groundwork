/**
 * The store rules behind the notification layer, as pure functions.
 *
 * The React part lives in `components/ui/Toast.tsx`; the policy lives here so a unit test can
 * hold it to its contract without a DOM — the same split `lib/optimistic.ts` and
 * `lib/writeChain.ts` already use, and the reason those two have tests at all.
 */

export type ToastTone = "success" | "error";

export interface ToastRecord {
  id: string;
  tone: ToastTone;
  text: string;
}

/** How long a success stays up. Errors never expire; see `applyCap`. */
export const SUCCESS_MS = 6_000;

/** How many toasts may be on screen at once. */
export const MAX_TOASTS = 3;

/*
 * Ids come from a module counter, not the clock.
 *
 * Two toasts raised in the same millisecond would share a `Date.now()` id, and duplicate React
 * keys are a console *error* — which `tests-e2e/console.spec.ts` fails on, across every page.
 * A counter cannot collide. It never reaches the server: toasts are raised in event handlers,
 * so nothing here is part of the server-rendered HTML and hydration cannot mismatch on it.
 */
let seq = 0;

export function nextToastId(): string {
  seq += 1;
  return `toast-${seq}`;
}

/**
 * Add one toast, respecting the cap.
 *
 * The eviction rule is the whole point: **an error is never evicted to make room.** Errors
 * persist because a message the user missed is worse than clutter, and letting an incoming
 * success push one off screen would defeat exactly that. So the cap drops the oldest
 * *auto-dismissing* toast, and when every slot holds an error the stack is allowed to grow —
 * three live failures is a situation someone needs to see, not a display problem.
 */
export function applyCap(
  list: readonly ToastRecord[],
  next: ToastRecord,
  max: number = MAX_TOASTS,
): ToastRecord[] {
  const grown = [...list, next];
  if (grown.length <= max) return grown;

  const victim = grown.findIndex((t) => t.tone !== "error");
  if (victim === -1) return grown;
  return grown.filter((_, i) => i !== victim);
}

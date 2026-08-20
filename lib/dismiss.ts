/**
 * Which layer Escape closes.
 *
 * ## The bug this exists to prevent
 *
 * Every dismissable surface used to bind its own `keydown` listener on `window`. That works
 * for exactly one of them. Open a card drawer, then a confirmation on top of it, press
 * Escape — both listeners fire, so the confirmation closes AND the drawer behind it closes,
 * and on the board that also mutates the URL. The user cancelled one thing and lost two.
 *
 * `stopPropagation` does not help, because both handlers are on the same target. Neither
 * does checking `event.defaultPrevented`, because listeners on one element all run.
 *
 * `CLAUDE.md` records three separate bugs of this shape already. So there is one listener
 * for the whole app, and a stack: Escape dismisses the top layer and nothing else.
 *
 * ## Why not rely on `<dialog showModal>`
 *
 * A modal dialog handles Escape natively and correctly. A drawer is deliberately NOT modal —
 * you keep clicking the board behind it, which is the whole reason it is a drawer — so it
 * gets no native Escape, and a mixed stack of native and manual handling is the same bug
 * wearing a different hat. Everything goes through here, including the modals.
 */

type Layer = { dismiss: () => void };

const stack: Layer[] = [];
let listening = false;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;

  const top = stack[stack.length - 1];
  if (!top) return;

  /*
   * Prevent the default before dismissing.
   *
   * A native `<dialog>` opened with `showModal()` closes itself on Escape, so without this
   * the dialog would close AND its `onDismiss` would run — which for a confirmation means
   * the caller's cancel path fires twice. Suppressing the browser's own handling makes this
   * stack the single decider, which is the entire point.
   */
  event.preventDefault();
  top.dismiss();
}

/**
 * Register a layer. Returns a function that removes it.
 *
 * The returned function is safe to call more than once and safe to call out of order — a
 * layer removes itself by identity, not by position, because React unmount order is not
 * guaranteed to be the reverse of mount order when several close at once.
 */
export function pushDismissLayer(dismiss: () => void): () => void {
  const layer: Layer = { dismiss };
  stack.push(layer);

  if (!listening && typeof window !== "undefined") {
    window.addEventListener("keydown", onKeyDown);
    listening = true;
  }

  return () => {
    const at = stack.indexOf(layer);
    if (at === -1) return;
    stack.splice(at, 1);

    if (stack.length === 0 && listening && typeof window !== "undefined") {
      window.removeEventListener("keydown", onKeyDown);
      listening = false;
    }
  };
}

/** How many layers are open. Used by tests, and by nothing else. */
export function layerCount(): number {
  return stack.length;
}

/** Drop every layer without dismissing them. Tests only — never call this from the app. */
export function resetDismissLayers(): void {
  stack.length = 0;
  if (listening && typeof window !== "undefined") {
    window.removeEventListener("keydown", onKeyDown);
    listening = false;
  }
}

/** Exposed so a test can drive the real handler rather than a copy of its logic. */
export const __dismissKeyHandler = onKeyDown;

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __dismissKeyHandler,
  layerCount,
  pushDismissLayer,
  resetDismissLayers,
} from "@/lib/dismiss";

/**
 * Which layer Escape closes.
 *
 * The bug this prevents: every dismissable surface used to bind its own `keydown` on
 * `window`, so opening a confirmation on top of a card drawer and pressing Escape closed
 * BOTH — the confirmation the user meant, and the drawer behind it, which on the board also
 * mutates the URL. `CLAUDE.md` records three earlier bugs of this exact shape.
 */

afterEach(() => resetDismissLayers());

/** Drives the real handler, so a broken listener cannot pass by testing a copy of itself. */
function pressEscape(): void {
  __dismissKeyHandler({ key: "Escape", preventDefault: () => {} } as KeyboardEvent);
}

function pressKey(key: string): void {
  __dismissKeyHandler({ key, preventDefault: () => {} } as KeyboardEvent);
}

describe("pushDismissLayer", () => {
  it("dismisses the only layer", () => {
    const spy = vi.fn();
    pushDismissLayer(spy);

    pressEscape();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("dismisses ONLY the top layer", () => {
    // The whole reason this module exists.
    const drawer = vi.fn();
    const confirmation = vi.fn();

    pushDismissLayer(drawer);
    pushDismissLayer(confirmation);

    pressEscape();
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(drawer).not.toHaveBeenCalled();
  });

  it("falls back to the layer below once the top one is removed", () => {
    const drawer = vi.fn();
    const confirmation = vi.fn();

    pushDismissLayer(drawer);
    const closeConfirm = pushDismissLayer(confirmation);

    closeConfirm();
    pressEscape();

    expect(drawer).toHaveBeenCalledTimes(1);
    expect(confirmation).not.toHaveBeenCalled();
  });

  it("ignores every key that is not Escape", () => {
    const spy = vi.fn();
    pushDismissLayer(spy);

    for (const key of ["Enter", "Tab", " ", "a", "ArrowDown"]) pressKey(key);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing when no layer is open", () => {
    expect(() => pressEscape()).not.toThrow();
    expect(layerCount()).toBe(0);
  });

  it("removes a layer by identity, not by position", () => {
    /*
     * React does not guarantee that unmount order is the reverse of mount order when
     * several components close at once. A stack that popped blindly would remove the wrong
     * layer and leave a dead handler on top, so Escape would silently do nothing.
     */
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();

    const removeFirst = pushDismissLayer(first);
    pushDismissLayer(second);
    pushDismissLayer(third);

    removeFirst();
    expect(layerCount()).toBe(2);

    pressEscape();
    expect(third).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it("tolerates a layer being removed twice", () => {
    // Strict Mode runs effect cleanups more than once; a second call must not remove
    // whatever happens to sit at that index now.
    const first = vi.fn();
    const second = vi.fn();

    const removeFirst = pushDismissLayer(first);
    pushDismissLayer(second);

    removeFirst();
    removeFirst();

    expect(layerCount()).toBe(1);
    pressEscape();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps counting layers as they open and close", () => {
    expect(layerCount()).toBe(0);
    const a = pushDismissLayer(() => {});
    const b = pushDismissLayer(() => {});
    expect(layerCount()).toBe(2);

    b();
    a();
    expect(layerCount()).toBe(0);
  });

  it("prevents the browser's own handling, so a native dialog does not also close", () => {
    /*
     * A `<dialog>` opened with `showModal()` closes itself on Escape. Without
     * `preventDefault`, the dialog would close AND its `onDismiss` would run — for a
     * confirmation that means the cancel path fires twice.
     */
    const preventDefault = vi.fn();
    pushDismissLayer(() => {});

    __dismissKeyHandler({ key: "Escape", preventDefault } as unknown as KeyboardEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("does not prevent default when there is nothing to dismiss", () => {
    // Escape has other meanings — leaving a text field, cancelling an IME composition.
    // Swallowing it with no layer open would break those.
    const preventDefault = vi.fn();
    __dismissKeyHandler({ key: "Escape", preventDefault } as unknown as KeyboardEvent);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

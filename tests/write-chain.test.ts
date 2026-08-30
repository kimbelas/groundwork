import { describe, expect, it, vi } from "vitest";

import { createWriteChain, isConflict } from "@/lib/writeChain";

/** A send() whose resolution the test controls, so writes can be made to overlap. */
function controllable() {
  const calls: { payload: Record<string, unknown>; expected: number; settle: (m: number) => void; fail: (e: unknown) => void }[] =
    [];
  const send = vi.fn((payload: Record<string, unknown>, expected: number) => {
    return new Promise<{ mtimeMs: number }>((resolve, reject) => {
      calls.push({
        payload,
        expected,
        settle: (mtimeMs) => resolve({ mtimeMs }),
        fail: reject,
      });
    });
  });
  return { send, calls };
}

const conflict = () => Object.assign(new Error("changed on disk"), { code: "conflict", status: 409 });

describe("createWriteChain", () => {
  it("carries the mtime each previous write returned, even when enqueues overlap", async () => {
    const { send, calls } = controllable();
    const chain = createWriteChain({ initialMtimeMs: 100, send });

    const a = chain.enqueue({ n: 1 });
    const b = chain.enqueue({ n: 2 });
    const c = chain.enqueue({ n: 3 });

    // Only the first is in flight; the others wait for its mtime.
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.expected).toBe(100);

    calls[0]?.settle(101);
    await a;
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.expected).toBe(101);

    calls[1]?.settle(102);
    await b;
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]?.expected).toBe(102);

    calls[2]?.settle(103);
    await c;
    expect(chain.mtimeMs()).toBe(103);
    expect(calls.map((x) => x.expected)).toEqual([100, 101, 102]);
  });

  it("a failure rejects everything queued behind it and keeps the last confirmed mtime", async () => {
    const { send, calls } = controllable();
    const chain = createWriteChain({ initialMtimeMs: 1, send });

    const a = chain.enqueue({ n: 1 });
    const b = chain.enqueue({ n: 2 });
    const c = chain.enqueue({ n: 3 });

    await Promise.resolve();
    calls[0]?.settle(2);
    await a;
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    calls[1]?.fail(new Error("boom"));
    await expect(b).rejects.toThrow("boom");
    await expect(c).rejects.toMatchObject({ code: "skipped" });

    // The third was never sent, and the chain is still usable at the last good baseline.
    expect(calls).toHaveLength(2);
    expect(chain.conflicted()).toBe(false);
    const d = chain.enqueue({ n: 4 });
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]?.expected).toBe(2);
    calls[2]?.settle(3);
    await d;
  });

  it("a conflict locks the chain until reset, and reports it once", async () => {
    const { send, calls } = controllable();
    const onConflict = vi.fn();
    const chain = createWriteChain({ initialMtimeMs: 1, send, onConflict });

    const a = chain.enqueue({ n: 1 });
    const b = chain.enqueue({ n: 2 });
    await Promise.resolve();
    calls[0]?.fail(conflict());

    await expect(a).rejects.toSatisfy(isConflict);
    await expect(b).rejects.toSatisfy(isConflict);
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(chain.conflicted()).toBe(true);

    // Nothing is sent while locked.
    await expect(chain.enqueue({ n: 3 })).rejects.toSatisfy(isConflict);
    expect(calls).toHaveLength(1);
    expect(onConflict).toHaveBeenCalledTimes(1);

    chain.reset(50);
    expect(chain.conflicted()).toBe(false);
    expect(chain.mtimeMs()).toBe(50);
    const d = chain.enqueue({ n: 4 });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.expected).toBe(50);
    calls[1]?.settle(51);
    await d;
  });

  it("idle() resolves immediately when nothing is queued and after the queue drains", async () => {
    const { send, calls } = controllable();
    const chain = createWriteChain({ initialMtimeMs: 1, send });

    await chain.idle();

    const a = chain.enqueue({ n: 1 });
    let settled = false;
    const waiting = chain.idle().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    calls[0]?.settle(2);
    await a;
    await waiting;
    expect(settled).toBe(true);
  });
});

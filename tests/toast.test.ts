import { describe, expect, it } from "vitest";

import { applyCap, nextToastId, type ToastRecord } from "@/lib/toast";

const t = (id: string, tone: ToastRecord["tone"]): ToastRecord => ({ id, tone, text: id });

describe("nextToastId", () => {
  it("never repeats, so two toasts in one millisecond cannot share a React key", () => {
    const ids = Array.from({ length: 50 }, () => nextToastId());
    expect(new Set(ids).size).toBe(50);
  });
});

describe("applyCap", () => {
  it("appends while there is room", () => {
    const list = applyCap([t("a", "success")], t("b", "success"));
    expect(list.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("drops the oldest auto-dismissing toast once full", () => {
    const full = [t("a", "success"), t("b", "success"), t("c", "success")];
    expect(applyCap(full, t("d", "success")).map((x) => x.id)).toEqual(["b", "c", "d"]);
  });

  it("never evicts an error to make room for a success", () => {
    const full = [t("err", "error"), t("b", "success"), t("c", "success")];
    const list = applyCap(full, t("d", "success"));
    expect(list.map((x) => x.id)).toEqual(["err", "c", "d"]);
    expect(list.some((x) => x.id === "err")).toBe(true);
  });

  it("lets the stack grow past the cap rather than lose a failure", () => {
    const errors = [t("e1", "error"), t("e2", "error"), t("e3", "error")];
    const list = applyCap(errors, t("e4", "error"));
    expect(list.map((x) => x.id)).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("evicts the oldest dismissible even when it is not first in the list", () => {
    const full = [t("e1", "error"), t("e2", "error"), t("ok", "success")];
    expect(applyCap(full, t("new", "success")).map((x) => x.id)).toEqual(["e1", "e2", "new"]);
  });
});

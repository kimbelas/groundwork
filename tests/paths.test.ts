import path from "node:path";
import { describe, expect, it } from "vitest";

import { VaultError } from "@/lib/errors";
import { assertCardFilename, assertSlug, containedPath, isValidSlug, slugify } from "@/lib/paths";

/**
 * Test 2 of the five. Everything here is a way a caller-supplied string could become a
 * path outside the vault, or a filename Windows will not honour.
 */

const ROOT = path.resolve("C:/vault-root");

describe("isValidSlug", () => {
  it("accepts ordinary slugs", () => {
    for (const s of ["portal-rebuild", "a", "x9", "a-b-c", "0start"]) {
      expect(isValidSlug(s), s).toBe(true);
    }
  });

  it("rejects traversal, separators and absolute paths", () => {
    for (const s of ["..", "../etc", "a/b", "a\\b", "/abs", "C:/abs", "a:b"]) {
      expect(isValidSlug(s), s).toBe(false);
    }
  });

  it("rejects shapes outside the documented regex", () => {
    for (const s of ["", "-leading", "UPPER", "has space", "trailing.", "a".repeat(65), "ünïcode"]) {
      expect(isValidSlug(s), s).toBe(false);
    }
  });

  it("rejects Windows reserved device names", () => {
    for (const s of ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"]) {
      expect(isValidSlug(s), s).toBe(false);
    }
  });

  it("allows names that merely start with a reserved word", () => {
    expect(isValidSlug("console")).toBe(true);
    expect(isValidSlug("nullable")).toBe(true);
  });
});

describe("assertSlug", () => {
  it("throws a typed error", () => {
    try {
      assertSlug("../escape");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError);
      expect((e as VaultError).code).toBe("invalid_slug");
      expect((e as VaultError).status).toBe(400);
    }
  });

  it("returns the slug so it can be used inline", () => {
    expect(assertSlug("portal-rebuild")).toBe("portal-rebuild");
  });
});

describe("assertCardFilename", () => {
  it("accepts the documented shape", () => {
    expect(assertCardFilename("0007-billing-api.md")).toBe("0007-billing-api.md");
  });

  it("rejects anything else", () => {
    for (const n of ["7-billing.md", "0007-Billing.md", "0007-billing.txt", "../0007-x.md", "0007-.md"]) {
      expect(() => assertCardFilename(n), n).toThrow(VaultError);
    }
  });

  it("rejects a reserved device name as the card slug", () => {
    expect(() => assertCardFilename("0004-nul.md")).toThrow(VaultError);
  });
});

describe("containedPath", () => {
  it("resolves inside the root", () => {
    expect(containedPath(ROOT, "portal-rebuild", "project.md")).toBe(
      path.join(ROOT, "portal-rebuild", "project.md"),
    );
  });

  it("rejects traversal even when it would land back inside", () => {
    expect(() => containedPath(ROOT, "a", "..", "..", "outside")).toThrow(VaultError);
  });

  it("rejects absolute segments", () => {
    expect(() => containedPath(ROOT, "C:/Windows/System32")).toThrow(VaultError);
    expect(() => containedPath(ROOT, "/etc/passwd")).toThrow(VaultError);
  });

  it("rejects NUL bytes, which truncate the path at the syscall layer", () => {
    expect(() => containedPath(ROOT, "ok\u0000../../escape")).toThrow(VaultError);
  });

  it("rejects empty segments", () => {
    expect(() => containedPath(ROOT, "")).toThrow(VaultError);
  });

  it("does not treat a sibling with a shared prefix as contained", () => {
    // C:/vault-root-other must not pass a naive startsWith check.
    expect(() => containedPath(ROOT, "..", "vault-root-other")).toThrow(VaultError);
  });
});

describe("slugify", () => {
  it("produces usable slugs", () => {
    expect(slugify("Portal Rebuild")).toBe("portal-rebuild");
    expect(slugify("  Spaces   everywhere  ")).toBe("spaces-everywhere");
    expect(slugify("Ünïcodé Näme")).toBe("unicode-name");
    expect(slugify("Symbols!@#$%^&*()")).toBe("symbols");
  });

  it("never returns something assertSlug would reject", () => {
    for (const name of ["NUL", "con", "!!!", "", "9lives", "-leading-", "x".repeat(200)]) {
      const s = slugify(name);
      expect(isValidSlug(s), `${name} -> ${s}`).toBe(true);
    }
  });
});

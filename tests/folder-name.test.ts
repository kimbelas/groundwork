import { describe, expect, it } from "vitest";

import { folderNameOf, isValidSlug, nameFromFolder, slugify } from "@/lib/slug";

/**
 * Turning a repository folder into a project name.
 *
 * These run in the browser bundle as well as on the server — the new-project drawer previews
 * the name and slug a path will produce before submitting — so they must stay free of
 * `node:path`. That is the whole reason they live in `lib/slug.ts` and not `lib/paths.ts`,
 * and it is why `folderNameOf` re-implements a basename instead of importing one.
 */

describe("folderNameOf", () => {
  it("takes the last segment of a Windows path", () => {
    expect(folderNameOf("C:\\Users\\me\\code\\tenant-portal")).toBe("tenant-portal");
  });

  it("takes the last segment of a POSIX path", () => {
    expect(folderNameOf("/home/me/code/tenant-portal")).toBe("tenant-portal");
  });

  it("ignores a trailing separator", () => {
    // A path copied from a file manager or completed by a shell often carries one.
    expect(folderNameOf("C:\\Users\\me\\repo\\")).toBe("repo");
    expect(folderNameOf("/home/me/repo/")).toBe("repo");
  });

  it("collapses repeated separators, including a UNC prefix", () => {
    expect(folderNameOf("//server/share/repo")).toBe("repo");
    expect(folderNameOf("C:\\\\Users\\\\me\\\\repo")).toBe("repo");
  });

  it("returns nothing for a bare drive, which names no project", () => {
    expect(folderNameOf("C:\\")).toBe("");
    expect(folderNameOf("D:")).toBe("");
  });

  it("returns nothing for an empty or whitespace path", () => {
    expect(folderNameOf("")).toBe("");
    expect(folderNameOf("   ")).toBe("");
  });
});

describe("nameFromFolder", () => {
  it("turns separators into spaces and capitalises each word", () => {
    expect(nameFromFolder("tenant-portal")).toBe("Tenant Portal");
    expect(nameFromFolder("tenant_portal_v2")).toBe("Tenant Portal V2");
    expect(nameFromFolder("tenant portal")).toBe("Tenant Portal");
  });

  it("leaves the rest of a word alone", () => {
    /*
     * The case that decides the rule: upper-casing the whole word would render `myAPI` as
     * `Myapi` and `API` as `Api`. A repository's capitalisation is a choice its author
     * already made, and this is a starting point for a title, not a correction of one.
     */
    expect(nameFromFolder("myAPI")).toBe("MyAPI");
    expect(nameFromFolder("API")).toBe("API");
    expect(nameFromFolder("gitHub-actions")).toBe("GitHub Actions");
  });

  it("drops the .git of a bare clone", () => {
    // "Groundwork Git" is nobody's project name.
    expect(nameFromFolder("groundwork.git")).toBe("Groundwork");
    expect(nameFromFolder("groundwork.GIT")).toBe("Groundwork");
  });

  it("keeps a dotted name readable", () => {
    expect(nameFromFolder("next.js-starter")).toBe("Next Js Starter");
  });

  it("keeps leading digits", () => {
    expect(nameFromFolder("2026-planner")).toBe("2026 Planner");
  });

  it("falls back to the folder when there is nothing to split", () => {
    expect(nameFromFolder("---")).toBe("---");
  });

  it("produces a legal slug for every plausible folder name", () => {
    /*
     * The two functions are used together and only together: the drawer derives a name and
     * immediately slugs it. A name that cannot become a slug would be a project that cannot
     * become a folder, discovered at the moment of writing rather than of typing.
     */
    const folders = [
      "tenant-portal",
      "myAPI",
      "2026-planner",
      "next.js-starter",
      "groundwork.git",
      "a",
      "UPPER_CASE_THING",
      "spaced out name",
      "---",
      "..hidden",
    ];

    for (const folder of folders) {
      expect(isValidSlug(slugify(nameFromFolder(folder)))).toBe(true);
    }
  });
});

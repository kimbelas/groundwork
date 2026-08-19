import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readData, split } from "@/lib/frontmatter";

/**
 * Answering questions.
 *
 * An answer is not cosmetic: every later run is given answered questions as confirmed
 * facts, so this is the path by which the plan actually improves. Losing or corrupting
 * one silently would be worse than failing to save it.
 */

let dir: string;
let vault: typeof import("@/lib/vault");

const PROJECT = `---
name: Q Test
slug: q-test
stage: shaping
health: green
archetype: client
columns: [Intake, Done]
created: 2026-08-01
updated: 2026-08-01
---

A brief.
`;

const QUESTIONS = `---
questions:
  - id: q1
    text: Who approves scope changes?
    status: open
    answer: null
    fromRun: run_20260819_0600
    created: 2026-08-01
  - id: q2
    text: Is IE11 still required?
    status: answered
    answer: No, dropped in January.
    fromRun: run_20260819_0600
    created: 2026-08-01
---

Prose under the frontmatter that must survive every write.
`;

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, contents, "utf8");
}

const questionsFile = () => path.join(dir, "q-test", "questions.md");

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "groundwork-q-"));
  process.env.GROUNDWORK_VAULT = dir;
  vi.resetModules();
  vault = await import("@/lib/vault");

  await write("q-test/project.md", PROJECT);
  await write("q-test/questions.md", QUESTIONS);
});

afterEach(async () => {
  delete process.env.GROUNDWORK_VAULT;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("getQuestions", () => {
  it("reads both open and answered", async () => {
    const questions = await vault.getQuestions("q-test");
    expect(questions).toHaveLength(2);
    expect(questions[0]?.status).toBe("open");
    expect(questions[1]?.answer).toBe("No, dropped in January.");
  });

  it("returns empty for a project with no questions file", async () => {
    await write("bare/project.md", "---\nname: Bare\n---\n");
    expect(await vault.getQuestions("bare")).toEqual([]);
  });
});

describe("setQuestionAnswer", () => {
  it("answers an open question", async () => {
    const { question } = await vault.setQuestionAnswer("q-test", "q1", "The account manager.");
    expect(question.status).toBe("answered");
    expect(question.answer).toBe("The account manager.");

    const onDisk = await vault.getQuestions("q-test");
    expect(onDisk.find((q) => q.id === "q1")?.answer).toBe("The account manager.");
  });

  it("leaves the document body byte-identical", async () => {
    const before = split(await fsp.readFile(questionsFile(), "utf8")).body;
    await vault.setQuestionAnswer("q-test", "q1", "An answer.");
    expect(split(await fsp.readFile(questionsFile(), "utf8")).body).toBe(before);
  });

  it("does not disturb the other questions", async () => {
    await vault.setQuestionAnswer("q-test", "q1", "An answer.");
    const q2 = (await vault.getQuestions("q-test")).find((q) => q.id === "q2");
    expect(q2?.answer).toBe("No, dropped in January.");
    expect(q2?.status).toBe("answered");
  });

  it("trims whitespace around an answer", async () => {
    const { question } = await vault.setQuestionAnswer("q-test", "q1", "   spaced   ");
    expect(question.answer).toBe("spaced");
  });

  it("treats a whitespace-only answer as reopening, not as an answer", async () => {
    const { question } = await vault.setQuestionAnswer("q-test", "q2", "    ");
    expect(question.status).toBe("open");
    expect(question.answer).toBeNull();
  });

  it("reopens an answered question when given null", async () => {
    const { question } = await vault.setQuestionAnswer("q-test", "q2", null);
    expect(question.status).toBe("open");
    expect(question.answer).toBeNull();
  });

  it("preserves fromRun and created so provenance is not lost", async () => {
    const { question } = await vault.setQuestionAnswer("q-test", "q1", "An answer.");
    expect(question.fromRun).toBe("run_20260819_0600");
    expect(question.created).toBe("2026-08-01");
  });

  it("rejects an unknown question id", async () => {
    await expect(vault.setQuestionAnswer("q-test", "q99", "x")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("rejects a traversal slug", async () => {
    await expect(vault.setQuestionAnswer("../escape", "q1", "x")).rejects.toMatchObject({
      code: "invalid_slug",
    });
  });

  it("409s on a stale mtime and writes nothing", async () => {
    const before = await fsp.readFile(questionsFile(), "utf8");
    await expect(vault.setQuestionAnswer("q-test", "q1", "x", 1)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await fsp.readFile(questionsFile(), "utf8")).toBe(before);
  });

  it("accepts the mtime it was given", async () => {
    const mtimeMs = await vault.auxMtime("q-test", "questions.md");
    await expect(
      vault.setQuestionAnswer("q-test", "q1", "fresh", mtimeMs),
    ).resolves.toBeTruthy();
  });

  it("advances the baseline so a second write in a row succeeds", async () => {
    const first = await vault.setQuestionAnswer(
      "q-test",
      "q1",
      "one",
      await vault.auxMtime("q-test", "questions.md"),
    );
    await expect(
      vault.setQuestionAnswer("q-test", "q1", "two", first.mtimeMs),
    ).resolves.toBeTruthy();
  });
});

describe("open question count", () => {
  it("feeds the project summary, which badges the rail and dashboard", async () => {
    expect((await vault.getProject("q-test")).openQuestions).toBe(1);

    await vault.setQuestionAnswer("q-test", "q1", "Answered now.");
    expect((await vault.getProject("q-test")).openQuestions).toBe(0);

    await vault.setQuestionAnswer("q-test", "q2", null);
    expect((await vault.getProject("q-test")).openQuestions).toBe(1);
  });
});

describe("questions document shape", () => {
  it("keeps the frontmatter parseable after a write", async () => {
    await vault.setQuestionAnswer("q-test", "q1", "An answer.");
    const data = readData(await fsp.readFile(questionsFile(), "utf8"));
    expect(Array.isArray(data.questions)).toBe(true);
    expect((data.questions as unknown[]).length).toBe(2);
  });
});

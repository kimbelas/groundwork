import type { AiEvent, AiJob } from "./types";

/**
 * The seam between the app and whatever is actually doing the thinking.
 *
 * One implementation ships (the Claude Code CLI) and one exists for tests. The
 * interface is not speculative generality: without it the e2e suite would have to
 * spawn a real model to exercise diff review, which would be slow, non-deterministic
 * and impossible to assert against. It is also where an Anthropic API implementation
 * would slot in later with no UI change.
 */
export interface AiEngine {
  readonly name: string;
  /**
   * Run a job to completion. Progress arrives through `onEvent`; the proposal is
   * written to the run directory rather than returned, so a disconnected browser does
   * not lose it.
   */
  run(job: AiJob, runId: string, onEvent: (e: AiEvent) => void): Promise<void>;
}

export type EngineName = "claude-cli" | "fixture";

export function engineName(): EngineName {
  return process.env.GROUNDWORK_AI_ENGINE === "fixture" ? "fixture" : "claude-cli";
}

export async function getEngine(): Promise<AiEngine> {
  if (engineName() === "fixture") {
    const { fixtureEngine } = await import("./fixture");
    return fixtureEngine;
  }
  const { claudeCliEngine } = await import("./claude-cli");
  return claudeCliEngine;
}

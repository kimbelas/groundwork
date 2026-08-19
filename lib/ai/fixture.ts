import { writeProposal } from "@/lib/runs";
import { getProject } from "@/lib/vault";

import type { AiEngine } from "./engine";
import type { AiEvent, AiJob, Proposal } from "./types";

/**
 * A deterministic engine for tests.
 *
 * The e2e suite has to exercise the whole path — progress streaming, validation,
 * grounding, diff review, apply — and it cannot do that against a real model without
 * becoming slow and unassertable. So this produces a fixed proposal derived from the
 * project's actual brief, which keeps the grounding check meaningful: quotes really are
 * taken from the real text, and one card deliberately quotes something that is not.
 *
 * Selected with `GROUNDWORK_AI_ENGINE=fixture`. Never reachable in normal use.
 */
async function buildProposal(job: AiJob, runId: string): Promise<Proposal> {
  const project = await getProject(job.slug);
  const brief = project.brief.trim();

  // A genuine sentence from the brief, so "quoted" is a real verification.
  const firstSentence = (brief.match(/[^.\n]{20,180}\./)?.[0] ?? brief.slice(0, 120)).trim();

  if (job.kind === "critique") {
    return {
      runId,
      job: "critique",
      slug: job.slug,
      summary: "Two gaps worth resolving before more cards are added.",
      phases: [],
      cards: [],
      risks: [
        {
          text: "Scope is defined by a brief that has not been reviewed with the client",
          likelihood: "med",
          impact: "high",
          mitigation: "Walk the brief through with them before phase 2 planning",
          groundedIn: null,
        },
      ],
      assumptions: [],
      questions: [
        { text: "Who signs off on scope changes once building starts?", blocks: "Phase 2" },
      ],
    };
  }

  if (job.kind === "enhance-card") {
    return {
      runId,
      job: "enhance-card",
      slug: job.slug,
      summary: `Expanded card ${job.cardId} against the brief.`,
      phases: [],
      cards: [
        {
          op: "update",
          id: job.cardId,
          title: "Expanded by the fixture engine",
          priority: "P1",
          size: "M",
          confidence: 0.6,
          body: "Rewritten with specifics drawn from the brief rather than boilerplate.",
          acceptance: ["The described behaviour is observable end to end"],
          groundedIn: firstSentence,
        },
      ],
      risks: [],
      assumptions: [],
      questions: [],
    };
  }

  return {
    runId,
    job: "synthesize",
    slug: job.slug,
    summary: "Three phases, three cards, and the questions the brief does not answer.",
    phases: [
      { n: 1, name: "Intake", goal: "Understand what exists before replacing any of it" },
      { n: 2, name: "Shaping", goal: "Lock the data model and the external contract" },
    ],
    cards: [
      {
        op: "create",
        title: "Establish what the current system actually does",
        column: "Intake",
        phase: 1,
        priority: "P1",
        size: "M",
        confidence: 0.7,
        body: "Trace the existing behaviour before changing it.",
        acceptance: ["Current behaviour is written down and agreed", "Gaps are listed explicitly"],
        groundedIn: firstSentence,
      },
      {
        op: "create",
        title: "Decide the integration boundary",
        column: "Shaping",
        phase: 2,
        priority: "P1",
        size: "L",
        confidence: 0.4,
        body: "Pin the contract with whatever is not being replaced.",
        acceptance: ["A round-trip is proven against a real endpoint"],
        groundedIn: null,
      },
      {
        // Deliberately quotes text the brief does not contain, so the e2e suite can
        // assert that the ungrounded warning actually fires.
        op: "create",
        title: "Migrate the legacy telemetry pipeline",
        column: "Intake",
        phase: 1,
        priority: "P3",
        size: "L",
        confidence: 0.2,
        body: "Invented work, included on purpose to prove the grounding check bites.",
        acceptance: ["This card should be rejected in review"],
        groundedIn: "the telemetry pipeline must be migrated before launch",
      },
    ],
    risks: [
      {
        text: "Behaviour parity with the current system is guesswork without tests",
        likelihood: "high",
        impact: "high",
        mitigation: "Record current behaviour as a spec before touching it",
        groundedIn: null,
      },
    ],
    assumptions: [
      { text: "A phased rollout is acceptable rather than a single cutover", groundedIn: null },
    ],
    questions: [
      { text: "How are users identified today?", blocks: "The data model" },
      { text: "What does done mean for the first release?", blocks: "Phase 2 scope" },
    ],
  };
}

export const fixtureEngine: AiEngine = {
  name: "fixture",

  async run(job: AiJob, runId: string, onEvent: (e: AiEvent) => void): Promise<void> {
    onEvent({ type: "step", label: "Reading the brief" });
    const proposal = await buildProposal(job, runId);

    onEvent({ type: "step", label: "Drafting phases" });
    onEvent({ type: "step", label: "Drafting cards" });
    onEvent({ type: "step", label: "Writing the proposal" });

    await writeProposal(runId, proposal);
    onEvent({ type: "done", runId });
  },
};

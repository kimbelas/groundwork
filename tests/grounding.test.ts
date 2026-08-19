import { describe, expect, it } from "vitest";

import { checkQuote, proposalWarnings, verifyGrounding } from "@/lib/ai/grounding";
import { ProposalSchema, type Proposal } from "@/lib/ai/types";

/**
 * The anti-invention check. If this is wrong in either direction the feature is worse
 * than absent: too strict and every honest citation reads "ungrounded" until the reader
 * ignores the warning; too loose and fabrication passes review looking verified.
 */

const BRIEF = `Property manager wants the tenant portal replaced. Right now tenants call
the office to report anything and the office keys it into the work order system by hand.

The work order system is a 2014 on-prem thing with a SOAP endpoint. It is not going away.`;

describe("checkQuote", () => {
  it("accepts an exact substring", () => {
    expect(checkQuote(BRIEF, "It is not going away.")).toEqual({
      status: "quoted",
      quote: "It is not going away.",
    });
  });

  it("accepts a quote the model re-wrapped across the brief's line break", () => {
    // The brief hard-wraps between "call" and "the office". A model quoting the
    // sentence will join it with a space, which is the same text, not a paraphrase.
    const result = checkQuote(BRIEF, "tenants call the office to report anything");
    expect(result.status).toBe("quoted");
  });

  it("accepts a quote whose internal whitespace differs", () => {
    expect(checkQuote(BRIEF, "SOAP    endpoint").status).toBe("quoted");
  });

  it("is case-insensitive on the normalised path", () => {
    expect(checkQuote(BRIEF, "SOAP ENDPOINT").status).toBe("quoted");
  });

  it("reports null as inferred rather than as a failure", () => {
    expect(checkQuote(BRIEF, null)).toEqual({ status: "inferred", quote: null });
  });

  it("rejects text that is not in the brief", () => {
    expect(checkQuote(BRIEF, "the telemetry pipeline must be migrated").status).toBe("ungrounded");
  });

  it("rejects a paraphrase, which is the whole point", () => {
    // Same meaning, different words. This must not pass.
    expect(checkQuote(BRIEF, "the legacy system will be retained").status).toBe("ungrounded");
  });

  it("rejects an empty or whitespace-only quote", () => {
    expect(checkQuote(BRIEF, "").status).toBe("ungrounded");
    expect(checkQuote(BRIEF, "   ").status).toBe("ungrounded");
  });

  it("does not treat an empty brief as quotable", () => {
    expect(checkQuote("", "anything at all").status).toBe("ungrounded");
  });
});

function proposal(over: Partial<Proposal> = {}): Proposal {
  return ProposalSchema.parse({
    runId: "run_20260819_0600",
    job: "synthesize",
    slug: "test",
    summary: "A summary.",
    cards: [],
    risks: [],
    assumptions: [],
    questions: [],
    phases: [],
    ...over,
  });
}

function card(groundedIn: string | null) {
  return {
    op: "create" as const,
    title: "A card",
    priority: "P2" as const,
    size: "M" as const,
    confidence: 0.5,
    body: "",
    acceptance: [],
    groundedIn,
  };
}

describe("verifyGrounding", () => {
  it("counts each category", () => {
    const report = verifyGrounding(
      BRIEF,
      proposal({
        cards: [card("It is not going away."), card(null), card("invented text")],
        risks: [
          {
            text: "r",
            likelihood: "med",
            impact: "med",
            mitigation: "",
            groundedIn: "also invented",
          },
        ],
        assumptions: [{ text: "a", groundedIn: null }],
      }),
    );

    expect(report.cards.map((c) => c.status)).toEqual(["quoted", "inferred", "ungrounded"]);
    expect(report.risks[0]?.status).toBe("ungrounded");
    expect(report.assumptions[0]?.status).toBe("inferred");
    expect(report.ungrounded).toBe(2);
    expect(report.inferred).toBe(2);
  });

  it("handles an empty proposal", () => {
    const report = verifyGrounding(BRIEF, proposal());
    expect(report.ungrounded).toBe(0);
    expect(report.inferred).toBe(0);
  });
});

describe("proposalWarnings", () => {
  it("warns when a quote is not in the brief", () => {
    const warnings = proposalWarnings(BRIEF, proposal({ cards: [card("invented")] }));
    expect(warnings.join(" ")).toMatch(/quoted text is not in it/);
  });

  it("warns when a short brief produced no questions", () => {
    const warnings = proposalWarnings("Two sentences. That is all.", proposal());
    expect(warnings.join(" ")).toMatch(/no open questions/);
  });

  it("does not warn about questions when the brief is long", () => {
    const long = "word ".repeat(200);
    expect(proposalWarnings(long, proposal()).join(" ")).not.toMatch(/no open questions/);
  });

  it("warns when nothing at all is traceable to the brief", () => {
    const warnings = proposalWarnings(
      BRIEF,
      proposal({ cards: [card(null), card(null)], questions: [{ text: "q", blocks: "" }] }),
    );
    expect(warnings.join(" ")).toMatch(/Every card is marked inferred/);
  });

  it("does not blame the cards for risks and assumptions being inferred", () => {
    // Regression from the first real model run: the "every card is inferred" warning
    // compared a vault-wide inferred total against the card count, so a proposal whose
    // every card was properly quoted got accused of being untraceable because its risks
    // and assumptions carried honest nulls.
    const warnings = proposalWarnings(
      BRIEF,
      proposal({
        cards: [card("It is not going away."), card("SOAP endpoint")],
        risks: [
          { text: "r1", likelihood: "med", impact: "med", mitigation: "", groundedIn: null },
          { text: "r2", likelihood: "med", impact: "med", mitigation: "", groundedIn: null },
        ],
        assumptions: [{ text: "a", groundedIn: null }],
        questions: [{ text: "q", blocks: "" }],
      }),
    );
    expect(warnings.join(" ")).not.toMatch(/Every card is marked inferred/);
  });

  it("still warns when the cards themselves are all inferred", () => {
    const warnings = proposalWarnings(
      BRIEF,
      proposal({
        cards: [card(null), card(null)],
        risks: [
          { text: "r", likelihood: "med", impact: "med", mitigation: "", groundedIn: "It is not going away." },
        ],
        questions: [{ text: "q", blocks: "" }],
      }),
    );
    expect(warnings.join(" ")).toMatch(/Every card is marked inferred/);
  });

  it("stays quiet on a well-grounded proposal", () => {
    const warnings = proposalWarnings(
      BRIEF,
      proposal({
        cards: [card("It is not going away."), card(null)],
        questions: [{ text: "q", blocks: "" }],
      }),
    );
    expect(warnings).toEqual([]);
  });
});

describe("ProposalSchema", () => {
  it("requires an id on an update", () => {
    const result = ProposalSchema.safeParse({
      runId: "run_20260819_0600",
      job: "synthesize",
      slug: "test",
      summary: "s",
      cards: [{ ...card(null), op: "update" }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses to let a create choose its own id", () => {
    const result = ProposalSchema.safeParse({
      runId: "run_20260819_0600",
      job: "synthesize",
      slug: "test",
      summary: "s",
      cards: [{ ...card(null), op: "create", id: 7 }],
    });
    expect(result.success).toBe(false);
  });

  it("has no delete operation at all", () => {
    const result = ProposalSchema.safeParse({
      runId: "run_20260819_0600",
      job: "synthesize",
      slug: "test",
      summary: "s",
      cards: [{ ...card(null), op: "delete" }],
    });
    expect(result.success).toBe(false);
  });

  it("requires groundedIn to be present, even as null", () => {
    const { groundedIn: _omitted, ...withoutGrounding } = card(null);
    const result = ProposalSchema.safeParse({
      runId: "run_20260819_0600",
      job: "synthesize",
      slug: "test",
      summary: "s",
      cards: [withoutGrounding],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a confidence outside 0-1", () => {
    const result = ProposalSchema.safeParse({
      runId: "run_20260819_0600",
      job: "synthesize",
      slug: "test",
      summary: "s",
      cards: [{ ...card(null), confidence: 1.5 }],
    });
    expect(result.success).toBe(false);
  });

  it("defaults the optional collections", () => {
    const parsed = ProposalSchema.parse({
      runId: "run_20260819_0600",
      job: "critique",
      slug: "test",
      summary: "s",
    });
    expect(parsed.cards).toEqual([]);
    expect(parsed.questions).toEqual([]);
  });
});

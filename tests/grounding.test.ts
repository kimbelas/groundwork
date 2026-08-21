import { describe, expect, it } from "vitest";

import { checkCodeQuote, checkQuote, proposalWarnings, verifyGrounding } from "@/lib/ai/grounding";
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

/**
 * `groundedInCode` — a claim about the code, with the code attached.
 *
 * The distinctions this holds are the ones that decide whether a citation can be trusted:
 * absent means the run had no code to cite, `null` means the code was read and settled
 * nothing, and a present object is a positive assertion the app will go and check. A
 * `.default()` anywhere in that chain would collapse the first into the third and fabricate
 * citations from silence — which is the failure CLAUDE.md records from `lib/ai/apply.ts`,
 * arriving in the one field where it would invent evidence.
 */
describe("likelihood spelling", () => {
  /*
   * A real run wrote "medium" and the whole proposal was rejected - six cards and six
   * questions discarded over two words in the risk register, because `med` is an
   * abbreviation the prompt could only show by example. The prompts now state the values;
   * this is the second layer.
   */
  function risk(over: Record<string, unknown>) {
    return ProposalSchema.safeParse({
      runId: "run_20260819_0600",
      job: "critique",
      slug: "test",
      summary: "s",
      risks: [{ text: "r", likelihood: "med", impact: "med", groundedIn: null, ...over }],
    });
  }

  it("accepts the word a model actually writes", () => {
    const parsed = risk({ likelihood: "medium", impact: "Moderate" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.risks[0]?.likelihood).toBe("med");
      expect(parsed.data.risks[0]?.impact).toBe("med");
    }
  });

  it("folds case on the canonical values", () => {
    const parsed = risk({ likelihood: "HIGH", impact: " low " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.risks[0]?.likelihood).toBe("high");
      expect(parsed.data.risks[0]?.impact).toBe("low");
    }
  });

  it("still refuses a word that is not a synonym", () => {
    // Normalising a synonym is not the same as guessing. "critical" is a judgement this
    // schema does not carry, so it fails and says so.
    expect(risk({ likelihood: "critical" }).success).toBe(false);
  });

  it("does not invent a value from a missing one", () => {
    // The preprocess passes non-strings through, so an absent field is still an error
    // rather than quietly becoming "med".
    expect(risk({ likelihood: undefined }).success).toBe(false);
    expect(risk({ likelihood: null }).success).toBe(false);
  });
});

describe("the code citation schema", () => {
  const cite = {
    path: "lib/ordering.ts",
    startLine: 40,
    endLine: 43,
    quote: "return 100 * (index + 1);",
  };

  function parse(over: Record<string, unknown>) {
    return ProposalSchema.safeParse({
      runId: "run_20260819_0600",
      job: "synthesize",
      slug: "test",
      summary: "s",
      cards: [{ ...card(null), ...over }],
    });
  }

  it("accepts a citation on a card, a risk and an assumption", () => {
    const result = ProposalSchema.safeParse({
      runId: "run_20260819_0600",
      job: "synthesize",
      slug: "test",
      summary: "s",
      cards: [{ ...card(null), groundedInCode: cite }],
      risks: [
        {
          text: "r",
          likelihood: "med",
          impact: "med",
          mitigation: "",
          groundedIn: null,
          groundedInCode: cite,
        },
      ],
      assumptions: [{ text: "a", groundedIn: null, groundedInCode: cite }],
    });
    expect(result.success).toBe(true);
  });

  it("keeps absent, null and present as three different answers", () => {
    const absent = parse({});
    const explicitNull = parse({ groundedInCode: null });
    const present = parse({ groundedInCode: cite });

    expect(absent.success && absent.data.cards[0]?.groundedInCode).toBeUndefined();
    expect(explicitNull.success && explicitNull.data.cards[0]?.groundedInCode).toBeNull();
    expect(present.success && present.data.cards[0]?.groundedInCode).toEqual(cite);
  });

  it("rejects a citation missing the quote, rather than storing a bare pointer", () => {
    // A path and a line range with no bytes is unverifiable by construction: there is
    // nothing for the string match to match, so it would be a claim that looks checked.
    const { quote: _dropped, ...noQuote } = cite;
    expect(parse({ groundedInCode: noQuote }).success).toBe(false);
  });

  it("rejects a range that ends before it starts, and a non-positive line", () => {
    expect(parse({ groundedInCode: { ...cite, endLine: 39 } }).success).toBe(false);
    expect(parse({ groundedInCode: { ...cite, startLine: 0 } }).success).toBe(false);
  });

  it("rejects a citation that is a bare string", () => {
    // The obvious shortcut — "lib/ordering.ts:40-43 — quote" — cannot be checked in two
    // halves, and both halves are checked.
    expect(parse({ groundedInCode: "lib/ordering.ts:40-43" }).success).toBe(false);
  });
});

/**
 * The same check for code, against the excerpts and nothing else.
 *
 * The distinction that earns this its own suite: a quote is matched inside the excerpt it
 * CITES, not anywhere in the file. Quoting one file while citing another is the shape a
 * plausible wrong answer actually takes, and a whole-file match would pass it.
 */
const EXCERPTS = `# Repository excerpts

## lib/ordering.ts:40-43

_matched by term_

\`\`\`
export function orderFor(cards: Card[], index: number): number {
  return 100 * (index + 1);
}
\`\`\`

## app/api/cards/route.ts:12-14

_matched by meaning_

\`\`\`
if (body.expectedMtimeMs !== current.mtimeMs) {
  throw new VaultError("conflict", "The card changed on disk");
}
\`\`\`
`;

const CITE = { path: "lib/ordering.ts", startLine: 40, endLine: 43, quote: "return 100 * (index + 1);" };

describe("checkCodeQuote", () => {
  it("accepts a verbatim quote from the excerpt it cites", () => {
    const result = checkCodeQuote(EXCERPTS, CITE);
    expect(result.status).toBe("quoted");
    expect(result.cite).toBe("lib/ordering.ts:40-43");
  });

  it("accepts a quote whose indentation was reflowed", () => {
    // JSON escaping and re-indentation are not paraphrase, and marking them ungrounded
    // teaches the reader to ignore the warning.
    expect(checkCodeQuote(EXCERPTS, { ...CITE, quote: "return   100 * (index + 1);" }).status).toBe(
      "quoted",
    );
  });

  it("refuses a quote whose identifier case is wrong", () => {
    // Stricter than the prose check on purpose: `orderFor` and `orderfor` are different
    // symbols, so a citation that mis-cases one is quoting from memory, not from the file.
    expect(
      checkCodeQuote(EXCERPTS, { ...CITE, quote: "export function orderfor(cards: Card[]" }).status,
    ).toBe("ungrounded");
  });

  it("refuses a real quote attributed to the wrong excerpt", () => {
    // The text below IS in the file — under a different heading. This is the case a
    // whole-file match would wave through.
    const result = checkCodeQuote(EXCERPTS, {
      ...CITE,
      quote: 'throw new VaultError("conflict", "The card changed on disk");',
    });
    expect(result.status).toBe("ungrounded");
  });

  it("refuses a citation of a line range that was never shown", () => {
    expect(checkCodeQuote(EXCERPTS, { ...CITE, startLine: 1, endLine: 9 }).status).toBe(
      "ungrounded",
    );
  });

  it("refuses any citation when the run had no excerpts at all", () => {
    // Nothing was shown, so nothing could have been read. This is the fabrication case.
    expect(checkCodeQuote(null, CITE).status).toBe("ungrounded");
  });

  it("keeps null and absent apart", () => {
    expect(checkCodeQuote(EXCERPTS, null).status).toBe("inferred");
    expect(checkCodeQuote(EXCERPTS, undefined).status).toBe("none");
  });
});

describe("verifyGrounding over code", () => {
  it("counts verified and unverified citations separately from the brief's", () => {
    const report = verifyGrounding(
      BRIEF,
      proposal({
        cards: [
          { ...card("It is not going away."), groundedInCode: CITE },
          { ...card(null), groundedInCode: { ...CITE, quote: "invented();" } },
          card(null),
        ],
      }),
      EXCERPTS,
    );

    expect(report.code.cards.map((c) => c.status)).toEqual(["quoted", "ungrounded", "none"]);
    expect(report.code.quoted).toBe(1);
    expect(report.code.ungrounded).toBe(1);
    // The brief-grounding numbers must not move: one quoted, two inferred, none ungrounded.
    expect(report.ungrounded).toBe(0);
    expect(report.inferred).toBe(2);
  });

  it("warns about an unverified code citation in its own sentence", () => {
    const warnings = proposalWarnings(
      BRIEF,
      proposal({
        cards: [{ ...card("It is not going away."), groundedInCode: { ...CITE, quote: "nope();" } }],
      }),
      EXCERPTS,
    );
    expect(warnings.some((w) => /cite the repository/.test(w))).toBe(true);
  });

  it("says nothing about code when a proposal cites none", () => {
    const warnings = proposalWarnings(BRIEF, proposal({ cards: [card("It is not going away.")] }), EXCERPTS);
    expect(warnings.some((w) => /repository/.test(w))).toBe(false);
  });
});

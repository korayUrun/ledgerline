import type { ContractTerms, TermsDraft } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { FIELD_NAMES, scoreFields, scorePayout } from "./score.js";

const TRUTH: ContractTerms = {
  deal: { type: "versus", guaranteeCents: 550_000, artistShareBps: 7000, clauseRef: "§2.1" },
  expensePolicy: {
    allowedCategories: ["catering", "security"],
    categoryCaps: [{ category: "security", capCents: 175_000 }],
    totalCapCents: null,
    clauseRef: "§3",
  },
  bonus: null,
};

// A perfect reading of TRUTH, as the extraction would produce it.
function perfectDraft(): TermsDraft {
  return {
    dealType: "versus",
    guaranteeCents: 550_000,
    artistShareBps: 7000,
    promoterProfitBps: null,
    dealClauseRef: "§2.1",
    allowedCategories: ["security", "catering"], // order does not matter
    categoryCaps: [{ category: "security", capCents: 175_000 }],
    totalCapCents: null,
    expenseClauseRef: "§3",
    bonus: null,
  };
}

const outcomeOf = (draft: TermsDraft | null, field: string) =>
  scoreFields(TRUTH, draft).find((score) => score.field === field)!.outcome;

describe("scoreFields", () => {
  it("scores every field of a perfect reading as correct, including the absent ones", () => {
    const scores = scoreFields(TRUTH, perfectDraft());
    expect(scores.map((score) => score.field)).toEqual(FIELD_NAMES);
    expect(scores.every((score) => score.outcome === "correct")).toBe(true);
  });

  it("tells a wrong value, a missed value and an invented value apart", () => {
    const draft = perfectDraft();
    draft.guaranteeCents = 275_000; // the deposit instead of the guarantee
    draft.artistShareBps = null; // not found
    draft.totalCapCents = 600_000; // the contract has no total cap

    expect(outcomeOf(draft, "deal.guaranteeCents")).toBe("wrong");
    expect(outcomeOf(draft, "deal.artistShareBps")).toBe("missed");
    expect(outcomeOf(draft, "expensePolicy.totalCapCents")).toBe("invented");
    expect(outcomeOf(draft, "bonus.mode")).toBe("correct"); // null and null
  });

  it("counts a failed extraction as missing every field that has a value", () => {
    const scores = scoreFields(TRUTH, null);
    expect(outcomeOf(null, "deal.type")).toBe("missed");
    expect(outcomeOf(null, "bonus.tiers")).toBe("correct"); // nothing to find
    expect(scores.filter((score) => score.outcome === "missed")).toHaveLength(7);
  });
});

describe("scorePayout", () => {
  const sales = [
    {
      id: "ts-1",
      tierName: "GA",
      qtySold: 400,
      comps: 0,
      priceCents: 4_000,
      taxCents: 0,
      feeCents: 0,
    },
  ];
  const expenses = [
    { id: "ex-1", category: "security" as const, amountCents: 200_000, status: "pending" as const },
  ];
  // NBOR 1,600,000 − expenses 175,000 (capped) = 1,425,000 × 70% = 997,500 > guarantee.
  const expected = 997_500;

  it("is exact when the extracted terms give the expected payout to the cent", () => {
    expect(scorePayout(perfectDraft(), sales, expenses, expected)).toEqual({
      exact: true,
      payoutCents: expected,
      reason: null,
    });
  });

  it("is not exact when a required term is missing, and says which", () => {
    const draft = perfectDraft();
    draft.artistShareBps = null;
    expect(scorePayout(draft, sales, expenses, expected)).toEqual({
      exact: false,
      payoutCents: null,
      reason: "missing: deal.artistShareBps",
    });
  });

  it("is not exact when a wrong term changes the money", () => {
    const draft = perfectDraft();
    draft.categoryCaps = []; // the cap was not seen: 25,000 more expenses deducted
    const result = scorePayout(draft, sales, expenses, expected);
    expect(result).toEqual({ exact: false, payoutCents: 980_000, reason: "payout differs" });
  });
});

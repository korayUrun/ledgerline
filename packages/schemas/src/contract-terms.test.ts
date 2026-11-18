import { describe, expect, it } from "vitest";
import { ContractTermsSchema, type ContractTerms } from "./contract-terms.js";

// The Lanterns at Hall 9, versus deal with a cumulative bonus (docs/domain.md §1, §6, §8).
// A function, so every test gets its own fresh copy to modify.
function versusTerms(): ContractTerms {
  return {
    deal: { type: "versus", guaranteeCents: 1_000_000, artistShareBps: 8500, clauseRef: "§4.1" },
    expensePolicy: {
      allowedCategories: ["production", "advertising", "catering", "security"],
      categoryCaps: [{ category: "advertising", capCents: 150_000 }],
      totalCapCents: 600_000,
      clauseRef: "§5",
    },
    bonus: {
      mode: "cumulative",
      tiers: [
        { minTicketsSold: 400, bonusCents: 50_000 },
        { minTicketsSold: 450, bonusCents: 75_000 },
        { minTicketsSold: 550, bonusCents: 100_000 },
      ],
      clauseRef: "§6",
    },
  };
}

describe("ContractTermsSchema", () => {
  it("accepts the domain.md versus example", () => {
    expect(ContractTermsSchema.safeParse(versusTerms()).success).toBe(true);
  });

  it("accepts all four deal types", () => {
    const deals = [
      { type: "flat", guaranteeCents: 1_000_000, clauseRef: "§4" },
      { type: "percentage", artistShareBps: 6000, clauseRef: "§4" },
      { type: "versus", guaranteeCents: 1_000_000, artistShareBps: 8500, clauseRef: "§4" },
      {
        type: "guarantee_plus",
        guaranteeCents: 1_000_000,
        artistShareBps: 8500,
        promoterProfitBps: 1500,
        clauseRef: "§4",
      },
    ];
    for (const deal of deals) {
      expect(ContractTermsSchema.safeParse({ ...versusTerms(), deal }).success).toBe(true);
    }
  });

  it("accepts terms without a bonus or a total cap", () => {
    const terms = versusTerms();
    terms.bonus = null;
    terms.expensePolicy.totalCapCents = null;
    expect(ContractTermsSchema.safeParse(terms).success).toBe(true);
  });

  describe("rejects", () => {
    it("a versus deal without a guarantee", () => {
      const terms = {
        ...versusTerms(),
        deal: { type: "versus", artistShareBps: 8500, clauseRef: "§4" },
      };
      expect(ContractTermsSchema.safeParse(terms).success).toBe(false);
    });

    it("a guarantee-plus deal without a promoter profit", () => {
      const deal = {
        type: "guarantee_plus",
        guaranteeCents: 1_000_000,
        artistShareBps: 8500,
        clauseRef: "§4",
      };
      expect(ContractTermsSchema.safeParse({ ...versusTerms(), deal }).success).toBe(false);
    });

    it("an unknown deal type", () => {
      const deal = { type: "door_deal", guaranteeCents: 1_000_000, clauseRef: "§4" };
      expect(ContractTermsSchema.safeParse({ ...versusTerms(), deal }).success).toBe(false);
    });

    it("a share above 100% (10,000 bps)", () => {
      const terms = versusTerms();
      terms.deal = {
        type: "versus",
        guaranteeCents: 1_000_000,
        artistShareBps: 10_001,
        clauseRef: "§4",
      };
      expect(ContractTermsSchema.safeParse(terms).success).toBe(false);
    });

    it.each([
      ["a fraction of a cent", 1_000_000.5],
      ["a negative amount", -1],
      ["more than MAX_CENTS", 1_000_000_001],
      ["NaN", Number.NaN],
    ])("a guarantee that is %s", (_name, guaranteeCents) => {
      const terms = versusTerms();
      terms.deal = { type: "flat", guaranteeCents, clauseRef: "§4" };
      expect(ContractTermsSchema.safeParse(terms).success).toBe(false);
    });

    it("an empty clauseRef", () => {
      const terms = versusTerms();
      terms.deal = { type: "flat", guaranteeCents: 1_000_000, clauseRef: "  " };
      expect(ContractTermsSchema.safeParse(terms).success).toBe(false);
    });

    it("an expense category outside the fixed list", () => {
      const terms = { ...versusTerms() };
      const expensePolicy = { ...terms.expensePolicy, allowedCategories: ["Advertising"] };
      expect(ContractTermsSchema.safeParse({ ...terms, expensePolicy }).success).toBe(false);
    });

    it("a cap on a category that is not allowed", () => {
      const terms = versusTerms();
      terms.expensePolicy.categoryCaps.push({ category: "office_supplies", capCents: 10_000 });
      const result = ContractTermsSchema.safeParse(terms);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("not an allowed category");
    });

    it("two caps on the same category", () => {
      const terms = versusTerms();
      terms.expensePolicy.categoryCaps.push({ category: "advertising", capCents: 90_000 });
      expect(ContractTermsSchema.safeParse(terms).success).toBe(false);
    });

    it("a category allowed twice", () => {
      const terms = versusTerms();
      terms.expensePolicy.allowedCategories.push("catering");
      expect(ContractTermsSchema.safeParse(terms).success).toBe(false);
    });

    it("two bonus tiers at the same threshold", () => {
      const terms = versusTerms();
      terms.bonus?.tiers.push({ minTicketsSold: 450, bonusCents: 1 });
      expect(ContractTermsSchema.safeParse(terms).success).toBe(false);
    });

    it("a bonus plan with no tiers", () => {
      const terms = versusTerms();
      if (terms.bonus) terms.bonus.tiers = [];
      expect(ContractTermsSchema.safeParse(terms).success).toBe(false);
    });
  });
});

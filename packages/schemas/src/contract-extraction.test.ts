import { describe, expect, it } from "vitest";
import {
  ContractExtractionSchema,
  draftToContractTerms,
  extractionToDraft,
  moneyTextToCents,
  normalizeClauseRef,
  percentTextToBps,
  type ContractExtraction,
} from "./contract-extraction.js";

const quote = (text: string, page = 1) => ({ quote: text, page });
const missing = { value: null, evidence: null };

// The Lanterns at Hall 9 versus deal (docs/domain.md §6, §8), as the model would
// return it: amounts copied as text, each value with the words it came from.
function versusExtraction(): ContractExtraction {
  return {
    deal: {
      type: { value: "versus", evidence: quote("a guarantee of $10,000.00 versus 85% of NBOR") },
      guarantee: { value: "$10,000.00", evidence: quote("a guarantee of $10,000.00") },
      artistShare: { value: "85%", evidence: quote("85% of Net Box Office Receipts") },
      promoterProfit: missing,
      clauseRef: { value: "§4.1", evidence: quote("4.1 Artist shall receive") },
    },
    expensePolicy: {
      allowedCategories: {
        value: ["production", "advertising", "catering", "security"],
        evidence: quote("production, advertising, catering and security"),
      },
      categoryCaps: [
        { category: "advertising", cap: "$1,500.00", evidence: quote("capped at $1,500.00") },
      ],
      totalCap: { value: "$6,000", evidence: quote("shall not exceed $6,000") },
      clauseRef: { value: "Section 5", evidence: quote("5. Expenses") },
    },
    bonus: {
      mode: { value: "cumulative", evidence: quote("Bonuses are cumulative") },
      tiers: [
        { minTicketsSold: 400, bonus: "$500", evidence: quote("400 or more paid tickets: $500") },
        { minTicketsSold: 450, bonus: "$750", evidence: quote("450 or more paid tickets: $750") },
      ],
      clauseRef: { value: "§6", evidence: quote("6. Bonuses") },
    },
  };
}

function issuesOf(extraction: unknown): string[] {
  const result = ContractExtractionSchema.safeParse(extraction);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("ContractExtractionSchema", () => {
  it("accepts a complete extraction", () => {
    expect(issuesOf(versusExtraction())).toEqual([]);
  });

  it("accepts missing values: null value with null evidence means 'not in the contract'", () => {
    const extraction = versusExtraction();
    extraction.deal.guarantee = missing;
    extraction.bonus = null;
    expect(issuesOf(extraction)).toEqual([]);
  });

  it("rejects a value without an evidence quote", () => {
    const extraction = versusExtraction();
    extraction.deal.guarantee = { value: "$10,000.00", evidence: null };
    expect(issuesOf(extraction)).toEqual([
      expect.stringMatching(/^deal\.guarantee\.evidence: .*quote/),
    ]);
  });

  it("rejects amounts and percentages that are not figures", () => {
    const extraction = versusExtraction();
    extraction.deal.guarantee.value = "ten thousand dollars";
    extraction.deal.artistShare.value = "120%";
    extraction.expensePolicy.categoryCaps[0]!.cap = "1.500,00";
    expect(issuesOf(extraction)).toEqual([
      expect.stringMatching(/^deal\.guarantee\.value: /),
      expect.stringMatching(/^deal\.artistShare\.value: /),
      expect.stringMatching(/^expensePolicy\.categoryCaps\.0\.cap: /),
    ]);
  });

  it("rejects terms that do not belong to the deal type", () => {
    const extraction = versusExtraction();
    extraction.deal.type.value = "percentage";
    expect(issuesOf(extraction)).toEqual([
      expect.stringMatching(/^deal\.guarantee\.value: .*percentage/),
    ]);
  });

  it("rejects a cap on a category that is not allowed, and bonus tiers that contradict", () => {
    const extraction = versusExtraction();
    extraction.expensePolicy.categoryCaps.push({
      category: "staffing",
      cap: "$300",
      evidence: quote("staffing capped at $300"),
    });
    extraction.bonus!.mode.value = "highest_only";
    extraction.bonus!.tiers[1]!.bonus = "$100";
    expect(issuesOf(extraction)).toEqual([
      expect.stringMatching(/^expensePolicy\.categoryCaps\.1\.category: /),
      expect.stringMatching(/^bonus\.tiers: .*pays less/),
    ]);
  });
});

describe("text → cents / bps (code converts, the model only copies)", () => {
  it.each([
    ["$12,500.00", 1_250_000],
    ["US $12,500", 1_250_000],
    ["USD 7,512.37", 751_237],
    ["12500", 1_250_000],
    ["twelve thousand", null],
    ["$1.500,00", null],
  ])("money %s → %s", (text, cents) => {
    expect(moneyTextToCents(text)).toBe(cents);
  });

  it.each([
    ["85%", 8500],
    ["12.5 %", 1250],
    ["85 percent", 8500],
    ["101%", null],
    ["eighty-five", null],
  ])("percent %s → %s", (text, bps) => {
    expect(percentTextToBps(text)).toBe(bps);
  });

  it.each([
    ["§4.1", "§4.1"],
    ["Section 4.1", "§4.1"],
    ["4.1", "§4.1"],
    [" § 5 ", "§5"],
    ["Schedule A", "Schedule A"],
  ])("clause %s → %s", (text, ref) => {
    expect(normalizeClauseRef(text)).toBe(ref);
  });
});

describe("extractionToDraft / draftToContractTerms", () => {
  it("converts a complete extraction into engine-ready terms", () => {
    const draft = extractionToDraft(ContractExtractionSchema.parse(versusExtraction()));
    expect(draftToContractTerms(draft)).toEqual({
      success: true,
      terms: {
        deal: {
          type: "versus",
          guaranteeCents: 1_000_000,
          artistShareBps: 8500,
          clauseRef: "§4.1",
        },
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
          ],
          clauseRef: "§6",
        },
      },
    });
  });

  it("names the required fields that are missing instead of guessing them", () => {
    const extraction = versusExtraction();
    extraction.deal.guarantee = missing;
    extraction.expensePolicy.clauseRef = missing;
    const draft = extractionToDraft(ContractExtractionSchema.parse(extraction));
    expect(draft.guaranteeCents).toBeNull();
    expect(draftToContractTerms(draft)).toEqual({
      success: false,
      missing: ["deal.guaranteeCents", "expensePolicy.clauseRef"],
      invalid: [],
    });
  });

  it("treats a missing expense list as 'no deductible expenses' only for deals that ignore expenses", () => {
    const extraction = versusExtraction();
    extraction.deal.type.value = "flat";
    extraction.deal.artistShare = missing;
    extraction.expensePolicy = {
      allowedCategories: missing,
      categoryCaps: [],
      totalCap: missing,
      clauseRef: missing,
    };
    const result = draftToContractTerms(
      extractionToDraft(ContractExtractionSchema.parse(extraction)),
    );
    // A flat deal still needs an expense clause reference: the reviewer must add it.
    expect(result).toEqual({ success: false, missing: ["expensePolicy.clauseRef"], invalid: [] });
  });

  it("reports values that break a ContractTerms rule instead of returning bad terms", () => {
    const extraction = versusExtraction();
    extraction.bonus!.tiers = []; // a bonus clause with no readable tiers
    const result = draftToContractTerms(
      extractionToDraft(ContractExtractionSchema.parse(extraction)),
    );
    expect(result).toEqual({
      success: false,
      missing: [],
      invalid: [expect.stringMatching(/^bonus\.tiers: /)],
    });
  });
});

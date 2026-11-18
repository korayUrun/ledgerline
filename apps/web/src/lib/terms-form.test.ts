import type { ContractExtraction, ContractTerms } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { bpsToInput, centsToInput } from "./format";
import { evidenceFromExtraction, termsFromForm, termsToDraft } from "./terms-form";

const GUARANTEE_PLUS: ContractTerms = {
  deal: {
    type: "guarantee_plus",
    guaranteeCents: 1_000_050,
    artistShareBps: 8500,
    promoterProfitBps: 1250,
    clauseRef: "§4.1",
  },
  expensePolicy: {
    allowedCategories: ["production", "advertising"],
    categoryCaps: [{ category: "advertising", capCents: 150_000 }],
    totalCapCents: null,
    clauseRef: "§5",
  },
  bonus: {
    mode: "highest_only",
    tiers: [
      { minTicketsSold: 400, bonusCents: 50_000 },
      { minTicketsSold: 450, bonusCents: 75_000 },
      { minTicketsSold: 500, bonusCents: 80_000 },
      { minTicketsSold: 550, bonusCents: 100_000 },
    ],
    clauseRef: "§4.2",
  },
};

// What the browser would submit for a form pre-filled from these terms: the
// same names and text values the TermsFields component renders.
function formFor(terms: ContractTerms): FormData {
  const draft = termsToDraft(terms);
  const form = new FormData();
  const set = (name: string, value: string) => form.set(name, value);
  set("dealType", draft.dealType ?? "");
  set("guarantee", centsToInput(draft.guaranteeCents));
  set("artistShare", bpsToInput(draft.artistShareBps));
  set("promoterProfit", bpsToInput(draft.promoterProfitBps));
  set("dealClause", draft.dealClauseRef ?? "");
  for (const category of draft.allowedCategories ?? []) set(`allow_${category}`, "on");
  for (const cap of draft.categoryCaps) set(`cap_${cap.category}`, centsToInput(cap.capCents));
  set("totalCap", "");
  set("expenseClause", draft.expenseClauseRef ?? "");
  set("bonusMode", draft.bonus?.mode ?? "none");
  set("bonusClause", draft.bonus?.clauseRef ?? "");
  const tiers = draft.bonus?.tiers ?? [];
  set("tierCount", String(Math.max(3, tiers.length)));
  tiers.forEach((tier, index) => {
    set(`tierTickets_${index}`, String(tier.minTicketsSold));
    set(`tierBonus_${index}`, centsToInput(tier.bonusCents));
  });
  return form;
}

describe("termsFromForm", () => {
  it("reads back exactly the terms the form was filled from, including a 4th bonus tier", () => {
    expect(termsFromForm(formFor(GUARANTEE_PLUS))).toEqual({
      terms: GUARANTEE_PLUS,
      problems: [],
    });
  });

  it("reports every field that does not parse instead of dropping it", () => {
    const form = formFor(GUARANTEE_PLUS);
    form.set("guarantee", "ten thousand");
    form.set("artistShare", "85 %%");
    form.set("tierTickets_1", "4.5");
    const { terms, problems } = termsFromForm(form);
    expect(terms).toBeNull();
    expect(problems).toEqual([
      "Guarantee: enter a dollar amount like 5000.00",
      "Artist share: enter a percentage like 85 or 12.5",
      "Bonus tier 2: tickets must be a whole number",
    ]);
  });

  it("asks for a deal type when none is chosen (a contract where it was not found)", () => {
    const form = formFor(GUARANTEE_PLUS);
    form.set("dealType", "");
    expect(termsFromForm(form)).toEqual({ terms: null, problems: ["Choose a deal type."] });
  });
});

describe("evidenceFromExtraction", () => {
  it("maps each extracted field to its quote, and missing values to 'missing'", () => {
    const quote = (text: string) => ({ quote: text, page: 2 });
    const missing = { value: null, evidence: null };
    const extraction: ContractExtraction = {
      deal: {
        type: { value: "flat", evidence: quote("a flat guarantee") },
        guarantee: { value: "$10,000", evidence: quote("a flat guarantee of $10,000") },
        artistShare: missing,
        promoterProfit: missing,
        clauseRef: missing,
      },
      expensePolicy: {
        allowedCategories: { value: ["advertising"], evidence: quote("advertising") },
        categoryCaps: [
          { category: "advertising", cap: "$500", evidence: quote("ads capped at $500") },
        ],
        totalCap: missing,
        clauseRef: missing,
      },
      bonus: null,
    };

    const evidence = evidenceFromExtraction(extraction);

    expect(evidence["guarantee"]).toEqual(quote("a flat guarantee of $10,000"));
    expect(evidence["dealClause"]).toBe("missing");
    expect(evidence["cap_advertising"]).toEqual(quote("ads capped at $500"));
    expect(evidence["bonusMode"]).toBe("missing"); // no bonus clause found
  });
});

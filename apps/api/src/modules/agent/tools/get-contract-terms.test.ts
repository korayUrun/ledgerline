import type { ContractExtraction } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { getContractTermsTool } from "./get-contract-terms.js";
import { auditContextFixture } from "./test-fixture.js";

describe("get_contract_terms", () => {
  it("returns the confirmed terms with money and percentages as text", async () => {
    const output = await getContractTermsTool(auditContextFixture()).run({});

    expect(output).toEqual({
      termsVersion: 1,
      deal: { type: "versus", guarantee: "$10,000.00", artistShare: "85%", clauseRef: "§4.1" },
      expensePolicy: {
        allowedCategories: ["production"],
        categoryCaps: [{ category: "production", cap: "$2,500.00" }],
        totalCap: null,
        clauseRef: "§5",
      },
      bonus: null,
      contractReading: null, // the fixture's terms were typed in by hand
    });
  });

  it("shows only the terms the deal type has, and the bonus tiers", async () => {
    const context = auditContextFixture();
    context.input.terms.deal = {
      type: "guarantee_plus",
      guaranteeCents: 500_000,
      artistShareBps: 8_500,
      promoterProfitBps: 1_500,
      clauseRef: "§4",
    };
    context.input.terms.bonus = {
      mode: "cumulative",
      tiers: [{ minTicketsSold: 300, bonusCents: 50_000 }],
      clauseRef: "§6",
    };

    const output = await getContractTermsTool(context).run({});

    expect(output).toMatchObject({
      deal: {
        type: "guarantee_plus",
        guarantee: "$5,000.00",
        artistShare: "85%",
        promoterProfit: "15%",
        clauseRef: "§4",
      },
      bonus: { mode: "cumulative", tiers: [{ minTicketsSold: 300, bonus: "$500.00" }] },
    });
  });

  it("passes the contract reading through with its quotes", async () => {
    const context = auditContextFixture();
    const quote = (text: string, page: number) => ({ quote: text, page });
    const none = { value: null, evidence: quote("", 0) };
    const extraction: ContractExtraction = {
      deal: {
        type: { value: "versus", evidence: quote("whichever is greater", 2) },
        guarantee: { value: "$10,000.00", evidence: quote("a guarantee of $10,000.00", 2) },
        artistShare: { value: "85%", evidence: quote("85% of net receipts", 2) },
        promoterProfit: none,
        clauseRef: { value: "§4.1", evidence: quote("4.1 Compensation", 2) },
      },
      expensePolicy: {
        allowedCategories: { value: ["production"], evidence: quote("production costs", 3) },
        categoryCaps: [],
        totalCap: none,
        clauseRef: none,
      },
      bonus: null,
    };
    context.extraction = extraction;

    const output = await getContractTermsTool(context).run({});

    expect(output).toMatchObject({ contractReading: extraction });
  });
});

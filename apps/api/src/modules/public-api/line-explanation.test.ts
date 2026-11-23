import type { ContractExtraction, SettlementInput } from "@ledgerline/schemas";
import { computeSettlement } from "@ledgerline/settlement-engine";
import { describe, expect, it } from "vitest";
import { explainLine, type LineExplanationInput } from "./line-explanation.js";

// $5,000 guarantee versus 85% of the net after expenses (§4.2); production allowed,
// capped at $2,000 (§5); a bonus of $500 from 300 paid tickets (§6). The lines come
// from the real engine, so the tests explain the worksheet the app would store.
const SNAPSHOT: SettlementInput = {
  terms: {
    deal: { type: "versus", guaranteeCents: 500_000, artistShareBps: 8_500, clauseRef: "§4.2" },
    expensePolicy: {
      allowedCategories: ["production"],
      categoryCaps: [{ category: "production", capCents: 200_000 }],
      totalCapCents: null,
      clauseRef: "§5",
    },
    bonus: {
      mode: "cumulative",
      tiers: [{ minTicketsSold: 300, bonusCents: 50_000 }],
      clauseRef: "§6",
    },
  },
  ticketSales: [
    {
      id: "ts-ga",
      tierName: "GA",
      qtySold: 320,
      comps: 25,
      priceCents: 3_500,
      taxCents: 56_000,
      feeCents: 22_400,
    },
  ],
  expenses: [
    { id: "ex-crew", category: "production", amountCents: 280_000, status: "allowed" },
    { id: "ex-toner", category: "office_supplies", amountCents: 9_000, status: "allowed" },
  ],
};

const quote = (text: string, page: number) => ({ quote: text, page });
const none = { value: null, evidence: quote("", 0) };

const EXTRACTION: ContractExtraction = {
  deal: {
    type: { value: "versus", evidence: quote("$5,000.00 versus 85% of net", 2) },
    guarantee: { value: "$5,000.00", evidence: quote("$5,000.00 versus 85% of net", 2) },
    artistShare: { value: "85%", evidence: quote("$5,000.00 versus 85% of net", 2) },
    promoterProfit: none,
    clauseRef: { value: "§4.2", evidence: quote("4.2 Compensation", 2) },
  },
  expensePolicy: {
    allowedCategories: { value: ["production"], evidence: quote("production costs only", 3) },
    categoryCaps: [
      { category: "production", cap: "$2,000.00", evidence: quote("not to exceed $2,000.00", 3) },
    ],
    totalCap: none,
    clauseRef: { value: "§5", evidence: quote("5. Expenses", 3) },
  },
  bonus: null,
};

function input(overrides: Partial<LineExplanationInput> = {}): LineExplanationInput {
  return {
    lines: computeSettlement(SNAPSHOT).lines,
    snapshot: SNAPSHOT,
    descriptions: new Map([
      ["ex-crew", "Stage crew"],
      ["ex-toner", "Printer toner"],
    ]),
    extraction: EXTRACTION,
    ...overrides,
  };
}

function positionOf(kind: string): number {
  return input().lines.findIndex((line) => line.kind === kind);
}

describe("explainLine", () => {
  it("gives a box office line with the ticket tiers it adds up, money in both forms", () => {
    const facts = explainLine(input(), positionOf("gbor"));

    expect(facts?.line).toMatchObject({
      kind: "gbor",
      amount: { cents: 1_120_000, formatted: "$11,200.00" },
      clauseRef: null,
    });
    expect(facts?.ticketSales).toEqual([
      {
        id: "ts-ga",
        tierName: "GA",
        qtySold: 320,
        comps: 25,
        price: { cents: 3_500, formatted: "$35.00" },
        tax: { cents: 56_000, formatted: "$560.00" },
        fees: { cents: 22_400, formatted: "$224.00" },
      },
    ]);
    expect(facts?.expenses).toEqual([]);
    expect(facts?.clauses).toEqual([]);
  });

  it("gives an expense line with its expenses, their descriptions and the policy clause", () => {
    const facts = explainLine(input(), positionOf("expense_disallowed"));

    expect(facts?.expenses).toEqual([
      {
        id: "ex-toner",
        category: "office_supplies",
        description: "Printer toner",
        amount: { cents: 9_000, formatted: "$90.00" },
        status: "allowed",
      },
    ]);
    expect(facts?.clauses).toEqual([
      {
        ref: "§5",
        section: "expense_policy",
        terms: [
          { name: "allowed categories", value: "production" },
          { name: "cap on production", value: "$2,000.00" },
          { name: "total cap", value: "none" },
        ],
        quotes: [
          { text: "production costs only", page: 3 },
          { text: "not to exceed $2,000.00", page: 3 },
        ],
      },
    ]);
  });

  it("gives a deal line with the confirmed terms and each contract quote once", () => {
    const facts = explainLine(input(), positionOf("deal_payout"));

    expect(facts?.clauses).toEqual([
      {
        ref: "§4.2",
        section: "deal",
        terms: [
          { name: "deal type", value: "versus" },
          { name: "guarantee", value: "$5,000.00" },
          { name: "artist share", value: "85%" },
        ],
        quotes: [{ text: "$5,000.00 versus 85% of net", page: 2 }],
      },
    ]);
  });

  it("has no quotes when the terms were typed in by hand", () => {
    const facts = explainLine(input({ extraction: null }), positionOf("bonus"));

    expect(facts?.clauses).toEqual([
      {
        ref: "§6",
        section: "bonus",
        terms: [
          { name: "bonus mode", value: "cumulative" },
          { name: "bonus at 300+ paid tickets", value: "$500.00" },
        ],
        quotes: [],
      },
    ]);
  });

  it("gives null description for an expense deleted after the compute", () => {
    const facts = explainLine(input({ descriptions: new Map() }), positionOf("expense_disallowed"));

    expect(facts?.expenses[0]?.description).toBeNull();
  });

  it("returns null for a position past the last line", () => {
    expect(explainLine(input(), input().lines.length)).toBeNull();
  });

  it("throws when a line points to a row the snapshot does not have (stored data is broken)", () => {
    const broken = input({ snapshot: { ...SNAPSHOT, ticketSales: [] } });

    expect(() => explainLine(broken, positionOf("gbor"))).toThrow(/not in the snapshot/);
  });
});

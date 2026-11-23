import type { SettlementInput } from "@ledgerline/schemas";
import { computeSettlement } from "@ledgerline/settlement-engine";
import type { AuditContext, AuditExpense } from "./audit-context.js";

// A small versus deal for the tool tests: $10,000 guarantee versus 85% of the net,
// production allowed up to $2,500, and one expense in a category the contract does
// not allow (the toner). The lines come from the real engine, so the tests see the
// same worksheet the app would store.
const EXPENSES: AuditExpense[] = [
  {
    id: "ex-crew",
    category: "production",
    description: "Stage crew, 6 people",
    amountCents: 280_000,
    status: "allowed",
    hasReceipt: true,
  },
  {
    id: "ex-toner",
    category: "office_supplies",
    description: "Printer toner",
    amountCents: 9_000,
    status: "pending",
    hasReceipt: false,
  },
];

const INPUT: SettlementInput = {
  terms: {
    deal: { type: "versus", guaranteeCents: 1_000_000, artistShareBps: 8_500, clauseRef: "§4.1" },
    expensePolicy: {
      allowedCategories: ["production"],
      categoryCaps: [{ category: "production", capCents: 250_000 }],
      totalCapCents: null,
      clauseRef: "§5",
    },
    bonus: null,
  },
  ticketSales: [
    {
      id: "ts-ga",
      tierName: "GA",
      qtySold: 400,
      comps: 20,
      priceCents: 3_500,
      taxCents: 112_000,
      feeCents: 40_000,
    },
  ],
  // The engine's view of the same rows: no description, no receipt.
  expenses: EXPENSES.map(({ id, category, amountCents, status }) => ({
    id,
    category,
    amountCents,
    status,
  })),
};

// A new object on every call, so one test cannot change what the next one sees.
export function auditContextFixture(): AuditContext {
  const result = computeSettlement(INPUT);
  return {
    settlement: {
      id: "settlement-1",
      status: "computed",
      version: 1,
      termsVersion: 1,
      payoutCents: result.payoutCents,
      computedAt: "2026-11-07T10:00:00.000Z",
    },
    input: structuredClone(INPUT),
    lines: result.lines,
    expenses: structuredClone(EXPENSES),
    extraction: null,
  };
}

import type { V1ExpenseFlag, V1LineExplanation, V1Settlement } from "@ledgerline/schemas";

// /v1 answers for the tool tests, in the published shapes (the client checks them).

export const SETTLEMENT_ID = "3eecc113-f334-4e9f-b4a7-0c1d2e3f4a5b";
export const EXPENSE_ID = "8f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

const money = (cents: number, formatted: string) => ({ cents, formatted });

const GBOR_LINE = {
  position: 0,
  kind: "gbor",
  label: "Gross box office receipts (GBOR)",
  amount: money(1_680_000, "$16,800.00"),
  clauseRef: null,
} as const;

export const SETTLEMENT: V1Settlement = {
  id: SETTLEMENT_ID,
  status: "in_review",
  version: 1,
  show: {
    id: "3321fa10-5c2b-4a1c-8a9d-647bf36084d2",
    name: "Friday",
    showDate: "2026-11-06",
    venueName: "Friday Hall",
    artistName: "Friday Band",
  },
  computedAt: "2026-11-07T09:00:00.000Z",
  termsVersion: 1,
  payout: money(500_000, "$5,000.00"),
  lines: [
    GBOR_LINE,
    {
      position: 1,
      kind: "total_payout",
      label: "Total artist payout",
      amount: money(500_000, "$5,000.00"),
      clauseRef: null,
    },
  ],
  payments: [],
  openFlagCount: 0,
};

export const EXPLANATION: V1LineExplanation = {
  settlementId: SETTLEMENT_ID,
  settlementVersion: 1,
  line: GBOR_LINE,
  ticketSales: [
    {
      id: "ts-ga",
      tierName: "GA",
      qtySold: 320,
      comps: 25,
      price: money(3_500, "$35.00"),
      tax: money(56_000, "$560.00"),
      fees: money(22_400, "$224.00"),
    },
  ],
  expenses: [],
  clauses: [],
};

export const FLAG: V1ExpenseFlag = {
  id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  expenseId: EXPENSE_ID,
  kind: "category_not_allowed",
  reason: "Office supplies are not an allowed category (§5).",
  status: "open",
  createdAt: "2026-11-07T09:05:00.000Z",
  created: true,
};

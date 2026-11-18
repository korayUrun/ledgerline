import {
  draftToContractTerms,
  type ContractTerms,
  type Expense,
  type TermsDraft,
  type TicketSale,
} from "@ledgerline/schemas";
import { computeSettlement } from "@ledgerline/settlement-engine";

// How one extraction is scored against the ground truth (docs/SYSTEM.md §11).
//
// Every field is turned into one comparable string (or null when the contract
// has no such term), so "correct" is a plain string comparison and lists compare
// regardless of order. Fields a deal type does not use count too: the truth is
// null, so a value there means the model invented something.

export type FieldOutcome =
  | "correct" // same value (or both absent)
  | "wrong" // both present, different value
  | "missed" // the contract has it, the extraction does not
  | "invented"; // the extraction has it, the contract does not

export type FieldScore = {
  field: string;
  expected: string | null;
  actual: string | null;
  outcome: FieldOutcome;
};

type Canonical = string | null;

const list = (items: string[]) => [...items].sort().join(", ");
const number = (value: number | null) => (value === null ? null : String(value));

// One entry per scored field: how to read it from the truth and from a draft.
const FIELDS: {
  name: string;
  truth: (t: ContractTerms) => Canonical;
  draft: (d: TermsDraft) => Canonical;
}[] = [
  { name: "deal.type", truth: (t) => t.deal.type, draft: (d) => d.dealType },
  {
    name: "deal.guaranteeCents",
    truth: (t) => ("guaranteeCents" in t.deal ? String(t.deal.guaranteeCents) : null),
    draft: (d) => number(d.guaranteeCents),
  },
  {
    name: "deal.artistShareBps",
    truth: (t) => ("artistShareBps" in t.deal ? String(t.deal.artistShareBps) : null),
    draft: (d) => number(d.artistShareBps),
  },
  {
    name: "deal.promoterProfitBps",
    truth: (t) => (t.deal.type === "guarantee_plus" ? String(t.deal.promoterProfitBps) : null),
    draft: (d) => number(d.promoterProfitBps),
  },
  { name: "deal.clauseRef", truth: (t) => t.deal.clauseRef, draft: (d) => d.dealClauseRef },
  {
    // An empty list ("no expenses are deducted") is a value, not an absence.
    name: "expensePolicy.allowedCategories",
    truth: (t) => list(t.expensePolicy.allowedCategories),
    draft: (d) => (d.allowedCategories === null ? null : list(d.allowedCategories)),
  },
  {
    // No caps at all is an absence: a cap the contract does not have is invented.
    name: "expensePolicy.categoryCaps",
    truth: (t) => caps(t.expensePolicy.categoryCaps),
    draft: (d) => caps(d.categoryCaps),
  },
  {
    name: "expensePolicy.totalCapCents",
    truth: (t) => number(t.expensePolicy.totalCapCents),
    draft: (d) => number(d.totalCapCents),
  },
  {
    name: "expensePolicy.clauseRef",
    truth: (t) => t.expensePolicy.clauseRef,
    draft: (d) => d.expenseClauseRef,
  },
  { name: "bonus.mode", truth: (t) => t.bonus?.mode ?? null, draft: (d) => d.bonus?.mode ?? null },
  {
    name: "bonus.tiers",
    truth: (t) => (t.bonus ? tiers(t.bonus.tiers) : null),
    draft: (d) => (d.bonus && d.bonus.tiers.length > 0 ? tiers(d.bonus.tiers) : null),
  },
  {
    name: "bonus.clauseRef",
    truth: (t) => t.bonus?.clauseRef ?? null,
    draft: (d) => d.bonus?.clauseRef ?? null,
  },
];

export const FIELD_NAMES = FIELDS.map((field) => field.name);

function caps(entries: { category: string; capCents: number }[]): Canonical {
  return entries.length === 0
    ? null
    : list(entries.map((cap) => `${cap.category}:${cap.capCents}`));
}

function tiers(entries: { minTicketsSold: number; bonusCents: number }[]): string {
  return list(entries.map((tier) => `${tier.minTicketsSold}:${tier.bonusCents}`));
}

// draft null = the extraction failed: everything the contract has was missed.
export function scoreFields(truth: ContractTerms, draft: TermsDraft | null): FieldScore[] {
  return FIELDS.map((field) => {
    const expected = field.truth(truth);
    const actual = draft === null ? null : field.draft(draft);
    let outcome: FieldOutcome;
    if (expected === actual) outcome = "correct";
    else if (actual === null) outcome = "missed";
    else if (expected === null) outcome = "invented";
    else outcome = "wrong";
    return { field: field.name, expected, actual, outcome };
  });
}

export type PayoutScore = {
  exact: boolean;
  payoutCents: number | null; // null when the extracted terms cannot be computed
  reason: string | null;
};

// End to end: would paying from the extracted terms give the right amount, to the
// cent? Uses the real engine on the case's ticket sales and expenses.
export function scorePayout(
  draft: TermsDraft | null,
  ticketSales: TicketSale[],
  expenses: Expense[],
  expectedPayoutCents: number,
): PayoutScore {
  if (draft === null) {
    return { exact: false, payoutCents: null, reason: "extraction failed" };
  }
  const conversion = draftToContractTerms(draft);
  if (!conversion.success) {
    const problems = [
      ...conversion.missing.map((name) => `missing: ${name}`),
      ...conversion.invalid.map((issue) => `invalid: ${issue}`),
    ];
    return { exact: false, payoutCents: null, reason: problems.join("; ") };
  }
  const { payoutCents } = computeSettlement({ terms: conversion.terms, ticketSales, expenses });
  return payoutCents === expectedPayoutCents
    ? { exact: true, payoutCents, reason: null }
    : { exact: false, payoutCents, reason: "payout differs" };
}

import { z } from "zod";
import { ClauseRefSchema, ContractTermsSchema, ExpenseCategorySchema } from "./contract-terms.js";
import { findDuplicates } from "./find-duplicates.js";
import { CentsSchema, MAX_CENTS, TicketCountSchema } from "./money.js";

const IdSchema = z.string().min(1);

// --- Inputs ----------------------------------------------------------------------
// These are the engine's view of a row, not the database row. Fields the math
// does not need (receipt file, free-text description) are left out on purpose:
// z.object drops unknown keys when parsing, so passing a DB row is safe.

export const TicketSaleSchema = z
  .object({
    id: IdSchema,
    tierName: z.string().min(1), // "GA", "VIP"… (not to be confused with bonus tiers)
    qtySold: TicketCountSchema, // paid tickets only
    comps: TicketCountSchema, // free tickets: counted, but bring in no money
    priceCents: CentsSchema, // face value per ticket
    taxCents: CentsSchema, // tier total, contained in qtySold × priceCents
    feeCents: CentsSchema, // tier total, contained in qtySold × priceCents
  })
  .superRefine((sale, ctx) => {
    // Tax and fees are part of the gross (docs/domain.md §2), so they can never
    // be larger than it. Without this check NBOR could go negative.
    const grossCents = sale.qtySold * sale.priceCents;
    if (sale.taxCents + sale.feeCents > grossCents) {
      ctx.addIssue({
        code: "custom",
        path: ["taxCents"],
        message: `tax + fees (${sale.taxCents + sale.feeCents}) exceed the tier gross (${grossCents})`,
      });
    }
  });
export type TicketSale = z.infer<typeof TicketSaleSchema>;

export const ExpenseStatusSchema = z.enum(["pending", "allowed", "disallowed"]);

export const ExpenseSchema = z.object({
  id: IdSchema,
  category: ExpenseCategorySchema,
  amountCents: CentsSchema,
  status: ExpenseStatusSchema, // only "disallowed" is dropped (docs/domain.md §3)
});
export type Expense = z.infer<typeof ExpenseSchema>;

export const SettlementInputSchema = z
  .object({
    terms: ContractTermsSchema,
    ticketSales: z.array(TicketSaleSchema),
    expenses: z.array(ExpenseSchema),
  })
  .superRefine((input, ctx) => {
    // Lines point back to rows by id, so ids must be unique.
    for (const id of findDuplicates(input.ticketSales.map((sale) => sale.id))) {
      ctx.addIssue({
        code: "custom",
        path: ["ticketSales"],
        message: `duplicate ticket sale id "${id}"`,
      });
    }
    for (const id of findDuplicates(input.expenses.map((expense) => expense.id))) {
      ctx.addIssue({ code: "custom", path: ["expenses"], message: `duplicate expense id "${id}"` });
    }

    // Each row is bounded, but many rows could still add up past MAX_CENTS and
    // break the safe-integer guarantee in money.ts. Bound the totals as well.
    let grossTotalCents = 0;
    for (const sale of input.ticketSales) {
      grossTotalCents += sale.qtySold * sale.priceCents;
    }
    if (grossTotalCents > MAX_CENTS) {
      ctx.addIssue({
        code: "custom",
        path: ["ticketSales"],
        message: `total gross exceeds ${MAX_CENTS} cents`,
      });
    }

    let expenseTotalCents = 0;
    for (const expense of input.expenses) {
      expenseTotalCents += expense.amountCents;
    }
    if (expenseTotalCents > MAX_CENTS) {
      ctx.addIssue({
        code: "custom",
        path: ["expenses"],
        message: `total expenses exceed ${MAX_CENTS} cents`,
      });
    }
  });
export type SettlementInput = z.infer<typeof SettlementInputSchema>;

// --- Output ----------------------------------------------------------------------

// Which input row(s) a line was computed from.
export const SourceRefSchema = z.object({
  type: z.enum(["ticket_sale", "expense"]),
  id: IdSchema,
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

// One kind per worksheet step (docs/domain.md §12, R1–R8).
export const LineKindSchema = z.enum([
  // revenue
  "gbor",
  "ticket_tax",
  "ticket_fees",
  "nbor",
  // expenses, in the order they are applied
  "expenses_submitted",
  "expense_disallowed",
  "expense_category_cap",
  "expense_total_cap",
  "allowed_expenses",
  // deal
  "guarantee",
  "net_after_expenses",
  "percentage_share",
  "promoter_profit",
  "split_point",
  "overage",
  "deal_payout",
  // bonus and total
  "bonus",
  "total_payout",
]);
export type LineKind = z.infer<typeof LineKindSchema>;

// The lines that add up to the payout. Every other line explains how we got
// there. The reconcile property test checks: Σ these lines = payoutCents.
export const PAYOUT_COMPONENT_KINDS = [
  "deal_payout",
  "bonus",
] as const satisfies readonly LineKind[];

export const SettlementLineSchema = z.object({
  kind: LineKindSchema,
  label: z.string().min(1),
  // Always ≥ 0: whether a line is subtracted is told by its kind, not its sign.
  // Not capped at MAX_CENTS: a sum such as the split point can be above it.
  amountCents: z.int().min(0),
  clauseRef: ClauseRefSchema.nullable(), // null when the line comes from data, not a clause (e.g. GBOR)
  sourceRefs: z.array(SourceRefSchema),
});
export type SettlementLine = z.infer<typeof SettlementLineSchema>;

export const SettlementResultSchema = z.object({
  payoutCents: z.int().min(0),
  lines: z.array(SettlementLineSchema).min(1),
});
export type SettlementResult = z.infer<typeof SettlementResultSchema>;

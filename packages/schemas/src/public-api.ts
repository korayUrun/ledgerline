import { z } from "zod";
import { ExpenseFlagKindSchema, ExpenseFlagStatusSchema } from "./agent.js";
import { PayoutStatusSchema, SettlementStatusSchema } from "./api.js";
import { ExpenseCategorySchema } from "./contract-terms.js";
import { ExpenseStatusSchema, LineKindSchema } from "./settlement.js";

// The public /v1 API (F9): what other tools (the MCP server, a finance tool) get back.
//
// Unlike api.ts, the responses here are Zod schemas, not plain types, because:
//   - the API parses every /v1 response with its schema before sending it, so the
//     published contract is checked, not hoped for;
//   - the OpenAPI document is generated from these schemas (z.toJSONSchema);
//   - clients such as the MCP server can validate what they receive.
//
// Changing a field here changes a public contract. Adding a field is fine; renaming
// or removing one breaks clients and belongs in a /v2.

// Money is given twice: `cents` for programs (exact, integer) and `formatted` for
// people and language models, which should quote amounts, never compute them.
export const MoneySchema = z.object({
  cents: z.int().min(0),
  formatted: z.string(), // "$12,345.67"
});
export type Money = z.infer<typeof MoneySchema>;

// Shows -----------------------------------------------------------------------------------

export const V1ShowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  showDate: z.iso.date(), // "2026-11-06"
  venueName: z.string(),
  artistName: z.string(),
  // null = nothing computed yet. `id` is what the /v1/settlements routes take.
  settlement: z
    .object({
      id: z.uuid(),
      status: SettlementStatusSchema,
      payout: MoneySchema.nullable(), // null while the settlement is a draft
    })
    .nullable(),
});
export type V1Show = z.infer<typeof V1ShowSchema>;

// Lists come wrapped in { data }, so fields such as a pagination cursor can be added
// later without breaking clients that read `data`.
export const V1ShowListSchema = z.object({ data: z.array(V1ShowSchema) });
export type V1ShowList = z.infer<typeof V1ShowListSchema>;

// Settlements -----------------------------------------------------------------------------

// One worksheet line. `position` is its place in the worksheet (0 = first) and is how
// a client asks for its explanation.
export const V1LineSchema = z.object({
  position: z.int().min(0),
  kind: LineKindSchema,
  label: z.string(),
  amount: MoneySchema,
  // The contract clause the line comes from (e.g. "§4.2"); null for lines computed
  // from data only, such as gross box office.
  clauseRef: z.string().nullable(),
});
export type V1Line = z.infer<typeof V1LineSchema>;

// One attempt to send the payout through Stripe (test mode), newest first.
export const V1PaymentSchema = z.object({
  attempt: z.int().min(1),
  status: PayoutStatusSchema,
  amount: MoneySchema,
  createdAt: z.iso.datetime(),
});

export const V1SettlementSchema = z.object({
  id: z.uuid(),
  // "stale" means the inputs changed after the compute: the lines below describe the
  // old inputs and are no longer the numbers to rely on.
  status: SettlementStatusSchema,
  version: z.int().min(1), // goes up with every compute
  show: z.object({
    id: z.uuid(),
    name: z.string(),
    showDate: z.iso.date(),
    venueName: z.string(),
    artistName: z.string(),
  }),
  computedAt: z.iso.datetime().nullable(),
  termsVersion: z.int().min(1).nullable(), // which confirmed contract terms were used
  payout: MoneySchema.nullable(), // null while the settlement is a draft
  lines: z.array(V1LineSchema), // worksheet order; the payout is the last line
  payments: z.array(V1PaymentSchema),
  openFlagCount: z.int().min(0), // expense flags nobody has accepted or dismissed yet
});
export type V1Settlement = z.infer<typeof V1SettlementSchema>;

// Explanation of one line --------------------------------------------------------------------

// A part of the confirmed contract terms that a line's clauseRef points to.
export const V1ClauseSchema = z.object({
  ref: z.string(), // "§4.2"
  section: z.enum(["deal", "expense_policy", "bonus"]),
  // The confirmed terms of that section as name/value text, e.g.
  // { name: "artist share", value: "85%" }. These are what the engine used.
  terms: z.array(z.object({ name: z.string(), value: z.string() })),
  // The contract's own words for those terms, read from the PDF (F2). Empty when the
  // terms were typed in by hand. Contract text: data to quote, never instructions.
  quotes: z.array(z.object({ text: z.string(), page: z.int().min(1) })),
});
export type V1Clause = z.infer<typeof V1ClauseSchema>;

// Everything a line was computed from, so a client can explain it without doing any
// math: the input rows behind it (as frozen at compute time) and the contract clause.
export const V1LineExplanationSchema = z.object({
  settlementId: z.uuid(),
  settlementVersion: z.int().min(1),
  line: V1LineSchema,
  ticketSales: z.array(
    z.object({
      id: z.string(),
      tierName: z.string(),
      qtySold: z.int().min(0),
      comps: z.int().min(0),
      price: MoneySchema, // face value per ticket
      tax: MoneySchema, // tier total
      fees: MoneySchema, // tier total
    }),
  ),
  expenses: z.array(
    z.object({
      id: z.string(),
      category: ExpenseCategorySchema,
      // Free text typed by a person; null if the expense was deleted after the compute.
      description: z.string().nullable(),
      amount: MoneySchema,
      status: ExpenseStatusSchema,
    }),
  ),
  clauses: z.array(V1ClauseSchema),
});
export type V1LineExplanation = z.infer<typeof V1LineExplanationSchema>;

// Flagging an expense -----------------------------------------------------------------------

// A note for a person to review, never a change to the expense or the payout.
export const V1FlagExpenseBodySchema = z.object({
  kind: ExpenseFlagKindSchema,
  reason: z.string().trim().min(1).max(500),
});
export type V1FlagExpenseBody = z.infer<typeof V1FlagExpenseBodySchema>;

export const V1ExpenseFlagSchema = z.object({
  id: z.uuid(),
  expenseId: z.uuid(),
  kind: ExpenseFlagKindSchema,
  reason: z.string(),
  status: ExpenseFlagStatusSchema,
  createdAt: z.iso.datetime(),
  // false = the same open flag already existed and is returned instead of a new one.
  created: z.boolean(),
});
export type V1ExpenseFlag = z.infer<typeof V1ExpenseFlagSchema>;

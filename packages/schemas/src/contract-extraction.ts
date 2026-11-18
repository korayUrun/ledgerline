import { z } from "zod";
import {
  BonusPlanSchema,
  ContractTermsSchema,
  ExpenseCategorySchema,
  type ContractTerms,
  type DealType,
  type ExpenseCategory,
} from "./contract-terms.js";
import { findDuplicates } from "./find-duplicates.js";
import { TicketCountSchema } from "./money.js";
import { parseDollarsToCents, parsePercentToBps } from "./money-text.js";

// What Claude returns when it reads a contract PDF (F2). It is NOT ContractTerms:
//   - every field is { value, evidence }, where evidence is the exact words from
//     the contract, so a reviewer can check the field in seconds;
//   - a value the contract does not state is null, never a guess;
//   - amounts and percentages are copied as TEXT ("$12,500.00", "85%"). Code
//     turns them into cents and basis points with the same helpers the web forms
//     use. The model reads; it never does arithmetic (CLAUDE.md), not even ×100.
//
// The same Zod schema serves twice: converted to JSON Schema, it is the output
// format we send to the API; then the reply is parsed with it again, because JSON
// Schema cannot express the refinements below (and LLM output is untrusted).

// --- Text → numbers ----------------------------------------------------------------------

// "$12,500.00", "US $12,500", "USD 7,512.37" → cents. Words ("ten thousand") and
// European formats ("1.500,00") give null.
export function moneyTextToCents(text: string): number | null {
  return parseDollarsToCents(text.trim().replace(/^(US\s*\$|USD\s*\$?|US\s+)/i, "$"));
}

// "85%", "12.5 %", "85 percent" → bps. Above 100% gives null.
export function percentTextToBps(text: string): number | null {
  return parsePercentToBps(text.trim().replace(/\s*(%|percent)$/i, ""));
}

// "Section 4.1", "4.1", "§ 4.1" → "§4.1", so refs compare equal however they are
// written. Text without a section number ("Schedule A") is kept as it is.
export function normalizeClauseRef(text: string): string {
  const number = /\d+(?:\.\d+)*/.exec(text);
  return number ? `§${number[0]}` : text.trim();
}

// --- Schema ------------------------------------------------------------------------------

export const EvidenceSchema = z.object({
  quote: z.string().describe("The exact words from the contract that state this value"),
  page: z.int().describe("1-based page number of the quote"),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

const MoneyTextSchema = z
  .string()
  .describe('The amount exactly as its figure is written, e.g. "$12,500.00"')
  .refine((text) => moneyTextToCents(text) !== null, {
    message: 'not a dollar figure; copy the amount in digits as written, e.g. "$12,500.00"',
  });

const PercentTextSchema = z
  .string()
  .describe('The percentage as written in digits, e.g. "85%"')
  .refine((text) => percentTextToBps(text) !== null, {
    message: 'not a percentage between 0% and 100% in digits, e.g. "85%"',
  });

// { value, evidence }. A value without evidence is rejected: if the model cannot
// point to the words, it must say null instead.
function field<T extends z.ZodType>(value: T) {
  return z
    .object({ value: value.nullable(), evidence: EvidenceSchema.nullable() })
    .superRefine((parsed, ctx) => {
      // Inside a generic, TypeScript cannot resolve the type of `value` (it depends
      // on T), so it drops the key. The schema above guarantees both keys exist.
      const extracted = parsed as { value: unknown; evidence: Evidence | null };
      if (extracted.value !== null && extracted.evidence === null) {
        ctx.addIssue({
          code: "custom",
          path: ["evidence"],
          message:
            "a value was given without an evidence quote; quote the exact words, or set value to null",
        });
      }
    });
}

const DealTypeSchema = z.enum(["flat", "percentage", "versus", "guarantee_plus"]);

// Which deal terms each deal type uses (docs/domain.md §4–§7).
const DEAL_FIELDS: Record<DealType, readonly ("guarantee" | "artistShare" | "promoterProfit")[]> = {
  flat: ["guarantee"],
  percentage: ["artistShare"],
  versus: ["guarantee", "artistShare"],
  guarantee_plus: ["guarantee", "artistShare", "promoterProfit"],
};

export const ContractExtractionSchema = z.object({
  deal: z
    .object({
      type: field(DealTypeSchema),
      guarantee: field(MoneyTextSchema),
      artistShare: field(PercentTextSchema),
      promoterProfit: field(PercentTextSchema),
      clauseRef: field(z.string().describe('The section number of the deal clause, e.g. "§4.1"')),
    })
    .superRefine((deal, ctx) => {
      // A term the deal type does not use is a contradiction: either the type or
      // the term was misread. Missing terms are fine here (null = not found).
      const type = deal.type.value;
      if (type === null) return;
      for (const name of ["guarantee", "artistShare", "promoterProfit"] as const) {
        if (deal[name].value !== null && !DEAL_FIELDS[type].includes(name)) {
          ctx.addIssue({
            code: "custom",
            path: [name, "value"],
            message: `a ${type} deal has no ${name}, but one was extracted; check the deal type and this value`,
          });
        }
      }
    }),
  expensePolicy: z
    .object({
      allowedCategories: field(z.array(ExpenseCategorySchema)),
      categoryCaps: z.array(
        z.object({
          category: ExpenseCategorySchema,
          cap: MoneyTextSchema,
          evidence: EvidenceSchema,
        }),
      ),
      totalCap: field(MoneyTextSchema),
      clauseRef: field(z.string()),
    })
    .superRefine((policy, ctx) => {
      const allowed = policy.allowedCategories.value;
      for (const category of findDuplicates(allowed ?? [])) {
        ctx.addIssue({
          code: "custom",
          path: ["allowedCategories", "value"],
          message: `category "${category}" is listed more than once`,
        });
      }
      policy.categoryCaps.forEach((cap, index) => {
        if (allowed !== null && !allowed.includes(cap.category)) {
          ctx.addIssue({
            code: "custom",
            path: ["categoryCaps", index, "category"],
            message: `cap on "${cap.category}", which is not in allowedCategories`,
          });
        }
      });
    }),
  // null = the contract has no bonus clause.
  bonus: z
    .object({
      mode: field(z.enum(["cumulative", "highest_only"])),
      tiers: z.array(
        z.object({
          minTicketsSold: TicketCountSchema.describe("Paid tickets needed to reach this tier"),
          bonus: MoneyTextSchema,
          evidence: EvidenceSchema,
        }),
      ),
      clauseRef: field(z.string()),
    })
    .nullable()
    .superRefine((bonus, ctx) => {
      if (bonus === null || bonus.mode.value === null) return;
      // Reuse the confirmed-terms rules (duplicate thresholds, highest-only order)
      // on the tiers whose amounts are readable.
      const tiers = bonus.tiers.flatMap((tier) => {
        const bonusCents = moneyTextToCents(tier.bonus);
        return bonusCents === null ? [] : [{ minTicketsSold: tier.minTicketsSold, bonusCents }];
      });
      if (tiers.length === 0) return;
      const result = BonusPlanSchema.safeParse({ mode: bonus.mode.value, tiers, clauseRef: "-" });
      for (const issue of result.success ? [] : result.error.issues) {
        ctx.addIssue({ code: "custom", path: ["tiers"], message: issue.message });
      }
    }),
});
export type ContractExtraction = z.infer<typeof ContractExtractionSchema>;

// --- Draft: the extraction in engine units, with gaps -----------------------------------
// This is what the review form starts from. null = missing, the reviewer fills it in.

export type TermsDraft = {
  dealType: DealType | null;
  guaranteeCents: number | null;
  artistShareBps: number | null;
  promoterProfitBps: number | null;
  dealClauseRef: string | null;
  allowedCategories: ExpenseCategory[] | null;
  categoryCaps: { category: ExpenseCategory; capCents: number }[];
  totalCapCents: number | null;
  expenseClauseRef: string | null;
  bonus: {
    mode: "cumulative" | "highest_only" | null;
    tiers: { minTicketsSold: number; bonusCents: number }[];
    clauseRef: string | null;
  } | null;
};

// Expects an extraction that passed ContractExtractionSchema, so every text parses.
export function extractionToDraft(extraction: ContractExtraction): TermsDraft {
  const { deal, expensePolicy, bonus } = extraction;
  const cents = (text: string | null) => (text === null ? null : moneyTextToCents(text));
  const bps = (text: string | null) => (text === null ? null : percentTextToBps(text));
  const ref = (text: string | null) => (text === null ? null : normalizeClauseRef(text));
  return {
    dealType: deal.type.value,
    guaranteeCents: cents(deal.guarantee.value),
    artistShareBps: bps(deal.artistShare.value),
    promoterProfitBps: bps(deal.promoterProfit.value),
    dealClauseRef: ref(deal.clauseRef.value),
    allowedCategories: expensePolicy.allowedCategories.value,
    categoryCaps: expensePolicy.categoryCaps.map((cap) => ({
      category: cap.category,
      capCents: moneyTextToCents(cap.cap)!,
    })),
    totalCapCents: cents(expensePolicy.totalCap.value),
    expenseClauseRef: ref(expensePolicy.clauseRef.value),
    bonus: bonus && {
      mode: bonus.mode.value,
      tiers: bonus.tiers.map((tier) => ({
        minTicketsSold: tier.minTicketsSold,
        bonusCents: moneyTextToCents(tier.bonus)!,
      })),
      clauseRef: ref(bonus.clauseRef.value),
    },
  };
}

export type DraftConversion =
  | { success: true; terms: ContractTerms }
  // missing: required fields with no value. invalid: values present but breaking a
  // ContractTermsSchema rule (e.g. a bonus clause with no tiers).
  | { success: false; missing: string[]; invalid: string[] };

// Draft → ContractTerms, only if nothing the engine needs is missing. Used by the
// eval runner ("would these extracted terms give the right payout?"). In the app a
// human fills the gaps in the review form instead.
export function draftToContractTerms(draft: TermsDraft): DraftConversion {
  const missing: string[] = [];
  function need<T>(value: T | null, name: string): T | null {
    if (value === null) missing.push(name);
    return value;
  }

  const type = need(draft.dealType, "deal.type");
  const uses = type === null ? [] : DEAL_FIELDS[type];
  const deal = {
    type,
    ...(uses.includes("guarantee") && {
      guaranteeCents: need(draft.guaranteeCents, "deal.guaranteeCents"),
    }),
    ...(uses.includes("artistShare") && {
      artistShareBps: need(draft.artistShareBps, "deal.artistShareBps"),
    }),
    ...(uses.includes("promoterProfit") && {
      promoterProfitBps: need(draft.promoterProfitBps, "deal.promoterProfitBps"),
    }),
    clauseRef: need(draft.dealClauseRef, "deal.clauseRef"),
  };

  // Flat and percentage deals deduct no expenses, so "no list found" is harmless
  // there. For versus and guarantee plus the list decides the payout: required.
  const ignoresExpenses = type === "flat" || type === "percentage";
  const allowedCategories =
    draft.allowedCategories ??
    (ignoresExpenses ? [] : need(draft.allowedCategories, "expensePolicy.allowedCategories"));

  const candidate = {
    deal,
    expensePolicy: {
      allowedCategories,
      categoryCaps: draft.categoryCaps,
      totalCapCents: draft.totalCapCents,
      clauseRef: need(draft.expenseClauseRef, "expensePolicy.clauseRef"),
    },
    bonus: draft.bonus && {
      mode: need(draft.bonus.mode, "bonus.mode"),
      tiers: draft.bonus.tiers,
      clauseRef: need(draft.bonus.clauseRef, "bonus.clauseRef"),
    },
  };
  if (missing.length > 0) {
    return { success: false, missing, invalid: [] };
  }
  // The same schema the API applies to hand-entered terms, so anything returned
  // here is something the engine accepts.
  const result = ContractTermsSchema.safeParse(candidate);
  if (!result.success) {
    return {
      success: false,
      missing: [],
      invalid: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  }
  return { success: true, terms: result.data };
}

import { z } from "zod";
import { findDuplicates } from "./find-duplicates.js";
import { BpsSchema, CentsSchema, TicketCountSchema } from "./money.js";

// Where in the contract a term is written, e.g. "§4.1". Every worksheet line
// that comes from a term shows this, so a reader can check it against the PDF.
export const ClauseRefSchema = z.string().trim().min(1);

// A fixed list, so "Advertising" and "advertising" can never silently fail to match.
export const ExpenseCategorySchema = z.enum([
  "production",
  "advertising",
  "catering",
  "security",
  "staffing",
  "equipment",
  "office_supplies",
  "other",
]);
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;

// --- Deal: one variant per deal type (docs/domain.md §4–§7) -------------------
// Each variant lists exactly the fields its formula needs, so a versus deal
// without a guarantee cannot even be written down.

const FlatDealSchema = z.object({
  type: z.literal("flat"),
  guaranteeCents: CentsSchema,
  clauseRef: ClauseRefSchema,
});

const PercentageDealSchema = z.object({
  type: z.literal("percentage"),
  artistShareBps: BpsSchema, // share of NBOR
  clauseRef: ClauseRefSchema,
});

const VersusDealSchema = z.object({
  type: z.literal("versus"),
  guaranteeCents: CentsSchema,
  artistShareBps: BpsSchema, // share of (NBOR − allowed expenses)
  clauseRef: ClauseRefSchema,
});

const GuaranteePlusDealSchema = z.object({
  type: z.literal("guarantee_plus"),
  guaranteeCents: CentsSchema,
  artistShareBps: BpsSchema, // share of the overage above the split point
  promoterProfitBps: BpsSchema, // of (allowed expenses + guarantee)
  clauseRef: ClauseRefSchema,
});

export const DealSchema = z.discriminatedUnion("type", [
  FlatDealSchema,
  PercentageDealSchema,
  VersusDealSchema,
  GuaranteePlusDealSchema,
]);
export type Deal = z.infer<typeof DealSchema>;
export type DealType = Deal["type"];

// --- Expense policy (docs/domain.md §3) ----------------------------------------
// Only versus and guarantee plus deduct expenses; flat and percentage ignore this.

export const ExpensePolicySchema = z
  .object({
    allowedCategories: z.array(ExpenseCategorySchema),
    categoryCaps: z.array(z.object({ category: ExpenseCategorySchema, capCents: CentsSchema })),
    totalCapCents: CentsSchema.nullable(), // null = the contract sets no total cap
    clauseRef: ClauseRefSchema,
  })
  .superRefine((policy, ctx) => {
    for (const category of findDuplicates(policy.allowedCategories)) {
      ctx.addIssue({
        code: "custom",
        path: ["allowedCategories"],
        message: `category "${category}" is listed more than once`,
      });
    }

    const cappedCategories = policy.categoryCaps.map((cap) => cap.category);
    for (const category of findDuplicates(cappedCategories)) {
      ctx.addIssue({
        code: "custom",
        path: ["categoryCaps"],
        message: `category "${category}" has more than one cap`,
      });
    }

    // A cap on a category the contract does not allow is a contradiction:
    // those expenses are dropped in step 1, so the cap could never apply.
    policy.categoryCaps.forEach((cap, index) => {
      if (!policy.allowedCategories.includes(cap.category)) {
        ctx.addIssue({
          code: "custom",
          path: ["categoryCaps", index, "category"],
          message: `cap on "${cap.category}", which is not an allowed category`,
        });
      }
    });
  });
export type ExpensePolicy = z.infer<typeof ExpensePolicySchema>;

// --- Bonus tiers (docs/domain.md §8) -------------------------------------------

export const BonusPlanSchema = z
  .object({
    mode: z.enum(["cumulative", "highest_only"]),
    tiers: z
      .array(
        z.object({
          minTicketsSold: TicketCountSchema.min(1), // reached when paid tickets ≥ this
          bonusCents: CentsSchema,
        }),
      )
      .min(1),
    clauseRef: ClauseRefSchema,
  })
  .superRefine((plan, ctx) => {
    // The engine sorts tiers itself, so order does not matter, but two tiers at
    // the same threshold would make "highest-only" ambiguous.
    const thresholds = plan.tiers.map((tier) => tier.minTicketsSold);
    for (const threshold of findDuplicates(thresholds)) {
      ctx.addIssue({
        code: "custom",
        path: ["tiers"],
        message: `more than one tier at ${threshold} tickets`,
      });
    }

    // Highest-only pays one tier, so a higher tier that pays less would make
    // selling one more ticket lower the payout. Found by the engine's property test.
    if (plan.mode === "highest_only") {
      const sortedTiers = [...plan.tiers].sort((a, b) => a.minTicketsSold - b.minTicketsSold);
      for (let index = 1; index < sortedTiers.length; index++) {
        const lower = sortedTiers[index - 1]!;
        const higher = sortedTiers[index]!;
        if (higher.bonusCents < lower.bonusCents) {
          ctx.addIssue({
            code: "custom",
            path: ["tiers"],
            message: `highest-only: the ${higher.minTicketsSold}-ticket tier pays less than the ${lower.minTicketsSold}-ticket tier`,
          });
        }
      }
    }
  });
export type BonusPlan = z.infer<typeof BonusPlanSchema>;

// --- ContractTerms: the confirmed terms the engine computes from ---------------
// This is the reviewed version. The extraction output in Phase 3 (every field
// with an evidence quote, nulls allowed) is a separate schema.

export const ContractTermsSchema = z.object({
  deal: DealSchema,
  expensePolicy: ExpensePolicySchema,
  bonus: BonusPlanSchema.nullable(), // null = no bonus clause
});
export type ContractTerms = z.infer<typeof ContractTermsSchema>;

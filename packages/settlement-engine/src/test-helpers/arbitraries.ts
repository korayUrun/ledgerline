import {
  ExpenseCategorySchema,
  type BonusPlan,
  type Deal,
  type Expense,
  type ExpensePolicy,
  type SettlementInput,
  type TicketSale,
} from "@ledgerline/schemas";
import fc from "fast-check";

// Generators of random but valid settlement inputs for the property tests.
// fast-check builds hundreds of these per test and, when a property fails,
// shrinks the failing input to the smallest one that still fails.
//
// The ranges keep every total far below MAX_CENTS (4 tiers × 3,000 tickets ×
// $200 = 2.4 × 10^8 cents), so the schema never rejects a generated input.

const CATEGORIES = ExpenseCategorySchema.options;
const cents = (max: number) => fc.integer({ min: 0, max });
const bps = fc.integer({ min: 0, max: 10_000 });

// Tax and fees are drawn inside the tier gross, as the schema requires.
const ticketSaleArb = fc
  .record({
    qtySold: fc.integer({ min: 0, max: 3000 }),
    comps: fc.integer({ min: 0, max: 200 }),
    priceCents: cents(20_000),
  })
  .chain((sale) => {
    const grossCents = sale.qtySold * sale.priceCents;
    return cents(grossCents).chain((taxCents) =>
      cents(grossCents - taxCents).map((feeCents) => ({ ...sale, taxCents, feeCents })),
    );
  });

export const ticketSalesArb: fc.Arbitrary<TicketSale[]> = fc
  .array(ticketSaleArb, { maxLength: 4 })
  .map((sales) =>
    sales.map((sale, index) => ({ id: `ts-${index}`, tierName: `Tier ${index}`, ...sale })),
  );

export const expensesArb: fc.Arbitrary<Expense[]> = fc
  .array(
    fc.record({
      category: fc.constantFrom(...CATEGORIES),
      amountCents: cents(500_000),
      status: fc.constantFrom("pending", "allowed", "disallowed"),
    }),
    { maxLength: 8 },
  )
  .map((expenses) => expenses.map((expense, index) => ({ id: `ex-${index}`, ...expense })));

// Caps are only placed on allowed categories, as the schema requires.
export const expensePolicyArb: fc.Arbitrary<ExpensePolicy> = fc
  .subarray([...CATEGORIES])
  .chain((allowedCategories) =>
    fc.record({
      allowedCategories: fc.constant(allowedCategories),
      categoryCaps: fc
        .subarray(allowedCategories)
        .chain((capped) =>
          fc.tuple(
            ...capped.map((category) => cents(500_000).map((capCents) => ({ category, capCents }))),
          ),
        ),
      totalCapCents: fc.option(cents(3_000_000), { nil: null }),
      clauseRef: fc.constant("§5"),
    }),
  );

const guaranteeArb = cents(2_000_000);

export const flatDealArb = fc.record({
  type: fc.constant("flat" as const),
  guaranteeCents: guaranteeArb,
  clauseRef: fc.constant("§4"),
});
export const percentageDealArb = fc.record({
  type: fc.constant("percentage" as const),
  artistShareBps: bps,
  clauseRef: fc.constant("§4"),
});
export const versusDealArb = fc.record({
  type: fc.constant("versus" as const),
  guaranteeCents: guaranteeArb,
  artistShareBps: bps,
  clauseRef: fc.constant("§4"),
});
export const guaranteePlusDealArb = fc.record({
  type: fc.constant("guarantee_plus" as const),
  guaranteeCents: guaranteeArb,
  artistShareBps: bps,
  promoterProfitBps: bps,
  clauseRef: fc.constant("§4"),
});
export const dealArb: fc.Arbitrary<Deal> = fc.oneof(
  flatDealArb,
  percentageDealArb,
  versusDealArb,
  guaranteePlusDealArb,
);

// Highest-only plans must not pay less for a higher tier (schema rule), so for
// them the thresholds and the amounts are both sorted and paired low to low.
export const bonusPlanArb: fc.Arbitrary<BonusPlan | null> = fc.option(
  fc
    .record({
      mode: fc.constantFrom("cumulative" as const, "highest_only" as const),
      tiers: fc.uniqueArray(
        fc.record({
          minTicketsSold: fc.integer({ min: 1, max: 12_000 }),
          bonusCents: cents(200_000),
        }),
        { minLength: 1, maxLength: 4, selector: (tier) => tier.minTicketsSold },
      ),
      clauseRef: fc.constant("§6"),
    })
    .map((plan) => {
      if (plan.mode === "cumulative") return plan;
      const thresholds = plan.tiers.map((tier) => tier.minTicketsSold).sort((a, b) => a - b);
      const amounts = plan.tiers.map((tier) => tier.bonusCents).sort((a, b) => a - b);
      const tiers = thresholds.map((minTicketsSold, index) => ({
        minTicketsSold,
        bonusCents: amounts[index]!,
      }));
      return { ...plan, tiers };
    }),
  { nil: null },
);

export function settlementInputArb(
  deal: fc.Arbitrary<Deal> = dealArb,
): fc.Arbitrary<SettlementInput> {
  return fc.record({
    terms: fc.record({ deal, expensePolicy: expensePolicyArb, bonus: bonusPlanArb }),
    ticketSales: ticketSalesArb,
    expenses: expensesArb,
  });
}

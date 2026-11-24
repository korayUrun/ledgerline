import {
  MAX_CENTS,
  PAYOUT_COMPONENT_KINDS,
  SettlementResultSchema,
  type LineKind,
  type SettlementLine,
} from "@ledgerline/schemas";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeSettlement } from "./compute-settlement.js";
import { computeAllowedExpenses } from "./expenses.js";
import { applyBps } from "./money.js";
import {
  expensePolicyArb,
  expensesArb,
  guaranteePlusDealArb,
  settlementInputArb,
  versusDealArb,
} from "./test-helpers/arbitraries.js";

// Phase 1 "Done when": every property passes with 1,000+ random inputs.
const NUM_RUNS = 1000;

// 1,000 runs take about 0.1 s locally, but on a busy CI runner, with coverage on and
// the first test paying for the warm-up, one test took over 5 s, Vitest's default
// limit (twice on 2026-11-24, no assertion failed). The limit guards against hangs,
// not speed, so property tests get a generous one.
const PROPERTY_TIMEOUT_MS = 30_000;

function sumOfKinds(lines: SettlementLine[], kinds: readonly LineKind[]): number {
  let totalCents = 0;
  for (const line of lines) {
    if (kinds.includes(line.kind)) totalCents += line.amountCents;
  }
  return totalCents;
}

function amountOf(lines: SettlementLine[], kind: LineKind): number | undefined {
  return lines.find((line) => line.kind === kind)?.amountCents;
}

describe("settlement properties", { timeout: PROPERTY_TIMEOUT_MS }, () => {
  it("payout is never negative, and every amount is a non-negative integer", () => {
    fc.assert(
      fc.property(settlementInputArb(), (input) => {
        const result = computeSettlement(input);
        expect(result.payoutCents).toBeGreaterThanOrEqual(0);
        expect(SettlementResultSchema.safeParse(result).success).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("versus: the deal payout is never below the guarantee", () => {
    fc.assert(
      fc.property(settlementInputArb(versusDealArb), (input) => {
        const result = computeSettlement(input);
        const guaranteeCents = amountOf(result.lines, "guarantee");
        expect(amountOf(result.lines, "deal_payout")).toBeGreaterThanOrEqual(guaranteeCents ?? 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("guarantee plus: the deal payout is never below the guarantee", () => {
    fc.assert(
      fc.property(settlementInputArb(guaranteePlusDealArb), (input) => {
        const result = computeSettlement(input);
        const guaranteeCents = amountOf(result.lines, "guarantee");
        expect(amountOf(result.lines, "deal_payout")).toBeGreaterThanOrEqual(guaranteeCents ?? 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the payout component lines add up to the payout and to the total line", () => {
    fc.assert(
      fc.property(settlementInputArb(), (input) => {
        const result = computeSettlement(input);
        expect(sumOfKinds(result.lines, PAYOUT_COMPONENT_KINDS)).toBe(result.payoutCents);
        expect(result.lines.at(-1)).toMatchObject({
          kind: "total_payout",
          amountCents: result.payoutCents,
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("payout never goes down when more tickets are sold", () => {
    const withExtraTickets = fc
      .tuple(
        settlementInputArb().filter((input) => input.ticketSales.length > 0),
        fc.nat(),
        fc.integer({ min: 1, max: 1000 }),
      )
      .map(([input, tierPick, extraTickets]) => {
        // Same taxes and fees, more paid tickets in one tier: only the gross grows.
        const tierIndex = tierPick % input.ticketSales.length;
        const moreSales = input.ticketSales.map((sale, index) =>
          index === tierIndex ? { ...sale, qtySold: sale.qtySold + extraTickets } : sale,
        );
        return { input, more: { ...input, ticketSales: moreSales } };
      });

    fc.assert(
      fc.property(withExtraTickets, ({ input, more }) => {
        expect(computeSettlement(more).payoutCents).toBeGreaterThanOrEqual(
          computeSettlement(input).payoutCents,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("expense properties", { timeout: PROPERTY_TIMEOUT_MS }, () => {
  it("submitted − dropped − capped = allowed, and allowed never exceeds the total cap", () => {
    fc.assert(
      fc.property(expensesArb, expensePolicyArb, (expenses, policy) => {
        const { allowedCents, lines } = computeAllowedExpenses(expenses, policy);
        const removedCents = sumOfKinds(lines, [
          "expense_disallowed",
          "expense_category_cap",
          "expense_total_cap",
        ]);
        expect(amountOf(lines, "expenses_submitted")! - removedCents).toBe(allowedCents);
        if (policy.totalCapCents !== null) {
          expect(allowedCents).toBeLessThanOrEqual(policy.totalCapCents);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("money properties", { timeout: PROPERTY_TIMEOUT_MS }, () => {
  const amountArb = fc.integer({ min: 0, max: MAX_CENTS });
  const bpsArb = fc.integer({ min: 0, max: 10_000 });

  it("applyBps is never more than half a cent away from the exact value", () => {
    fc.assert(
      fc.property(amountArb, bpsArb, (amountCents, bps) => {
        // Compared in ten-thousandths of a cent so the test itself uses no fractions.
        const errorTimes10000 = applyBps(amountCents, bps) * 10_000 - amountCents * bps;
        expect(errorTimes10000).toBeGreaterThan(-5000); // exactly half rounds up, never down
        expect(errorTimes10000).toBeLessThanOrEqual(5000);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("applyBps never goes down when the amount goes up", () => {
    fc.assert(
      fc.property(amountArb, amountArb, bpsArb, (a, b, bps) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(applyBps(high, bps)).toBeGreaterThanOrEqual(applyBps(low, bps));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

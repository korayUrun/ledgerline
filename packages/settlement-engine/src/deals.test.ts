import { describe, expect, it } from "vitest";
import {
  computeFlatDeal,
  computeGuaranteePlusDeal,
  computePercentageDeal,
  computeVersusDeal,
} from "./deals.js";

// NBOR and allowed expenses for the two nights (docs/domain.md §2, §3).
const STRONG_NBOR = 1_928_000;
const WEAK_NBOR = 1_188_000;
const EXPENSES = 600_000;

describe("flat guarantee (docs/domain.md §4)", () => {
  it("pays the guarantee", () => {
    const outcome = computeFlatDeal({ type: "flat", guaranteeCents: 1_000_000, clauseRef: "§4" });
    expect(outcome.dealPayoutCents).toBe(1_000_000);
    expect(outcome.lines.map((line) => line.kind)).toEqual(["guarantee", "deal_payout"]);
  });
});

describe("percentage of NBOR (docs/domain.md §5)", () => {
  const deal = { type: "percentage", artistShareBps: 6000, clauseRef: "§4" } as const;

  it("strong night: 60% of 1,928,000 = 1,156,800", () => {
    expect(computePercentageDeal(deal, STRONG_NBOR).dealPayoutCents).toBe(1_156_800);
  });

  it("weak night: 60% of 1,188,000 = 712,800", () => {
    expect(computePercentageDeal(deal, WEAK_NBOR).dealPayoutCents).toBe(712_800);
  });
});

describe("versus (docs/domain.md §6)", () => {
  const deal = {
    type: "versus",
    guaranteeCents: 1_000_000,
    artistShareBps: 8500,
    clauseRef: "§4",
  } as const;

  it("strong night: the percentage wins, 1,128,800", () => {
    const outcome = computeVersusDeal(deal, STRONG_NBOR, EXPENSES);
    expect(outcome.dealPayoutCents).toBe(1_128_800);
    expect(outcome.lines.map((line) => [line.kind, line.amountCents])).toEqual([
      ["guarantee", 1_000_000],
      ["net_after_expenses", 1_328_000],
      ["percentage_share", 1_128_800],
      ["deal_payout", 1_128_800],
    ]);
    expect(outcome.lines.at(-1)?.label).toContain("percentage is higher");
  });

  it("weak night: the guarantee wins, 1,000,000", () => {
    const outcome = computeVersusDeal(deal, WEAK_NBOR, EXPENSES);
    expect(outcome.dealPayoutCents).toBe(1_000_000);
    expect(outcome.lines.at(-1)?.label).toContain("guarantee is higher");
  });

  it("self-check 1: guarantee 1,200,000 vs 90% → the guarantee wins", () => {
    const outcome = computeVersusDeal(
      { ...deal, guaranteeCents: 1_200_000, artistShareBps: 9000 },
      STRONG_NBOR,
      EXPENSES,
    );
    expect(outcome.dealPayoutCents).toBe(1_200_000);
  });

  it("expenses above NBOR: the share is 0, not negative, and the guarantee is paid", () => {
    const outcome = computeVersusDeal(deal, 500_000, EXPENSES);
    const netLine = outcome.lines.find((line) => line.kind === "net_after_expenses");
    expect(netLine?.amountCents).toBe(0);
    expect(outcome.dealPayoutCents).toBe(1_000_000);
  });
});

describe("guarantee plus (docs/domain.md §7)", () => {
  const deal = {
    type: "guarantee_plus",
    guaranteeCents: 1_000_000,
    artistShareBps: 8500,
    promoterProfitBps: 1500,
    clauseRef: "§4",
  } as const;

  it("strong night: split point 1,840,000, overage 88,000, payout 1,074,800", () => {
    const outcome = computeGuaranteePlusDeal(deal, STRONG_NBOR, EXPENSES);
    expect(outcome.dealPayoutCents).toBe(1_074_800);
    expect(outcome.lines.map((line) => [line.kind, line.amountCents])).toEqual([
      ["guarantee", 1_000_000],
      ["promoter_profit", 240_000],
      ["split_point", 1_840_000],
      ["overage", 88_000],
      ["percentage_share", 74_800],
      ["deal_payout", 1_074_800],
    ]);
  });

  it("weak night: below the split point, payout is the guarantee", () => {
    const outcome = computeGuaranteePlusDeal(deal, WEAK_NBOR, EXPENSES);
    expect(outcome.dealPayoutCents).toBe(1_000_000);
    expect(outcome.lines.find((line) => line.kind === "overage")?.amountCents).toBe(0);
  });

  it("self-check 2: guarantee 800,000, profit 20%, share 90% → 1,023,200", () => {
    const outcome = computeGuaranteePlusDeal(
      { ...deal, guaranteeCents: 800_000, promoterProfitBps: 2000, artistShareBps: 9000 },
      STRONG_NBOR,
      EXPENSES,
    );
    expect(outcome.lines.map((line) => [line.kind, line.amountCents])).toEqual([
      ["guarantee", 800_000],
      ["promoter_profit", 280_000],
      ["split_point", 1_680_000],
      ["overage", 248_000],
      ["percentage_share", 223_200],
      ["deal_payout", 1_023_200],
    ]);
  });

  it("§10: with promoter profit 10% it pays 1,142,800 on the strong night, more than versus", () => {
    const outcome = computeGuaranteePlusDeal(
      { ...deal, promoterProfitBps: 1000 },
      STRONG_NBOR,
      EXPENSES,
    );
    expect(outcome.dealPayoutCents).toBe(1_142_800);
  });
});

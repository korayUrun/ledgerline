import { PAYOUT_COMPONENT_KINDS, type SettlementInput } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { computeSettlement } from "./compute-settlement.js";
import {
  FLAT_DEAL,
  GUARANTEE_PLUS_DEAL,
  PERCENTAGE_DEAL,
  STRONG_NIGHT_SALES,
  VERSUS_DEAL,
  WEAK_NIGHT_SALES,
  hall9BonusPlan,
  hall9Input,
} from "./test-helpers/domain-examples.js";

describe("computeSettlement: every deal type on both nights (docs/domain.md §4–§7)", () => {
  it.each([
    ["flat", FLAT_DEAL, STRONG_NIGHT_SALES, 1_000_000],
    ["flat", FLAT_DEAL, WEAK_NIGHT_SALES, 1_000_000],
    ["percentage", PERCENTAGE_DEAL, STRONG_NIGHT_SALES, 1_156_800],
    ["percentage", PERCENTAGE_DEAL, WEAK_NIGHT_SALES, 712_800],
    ["versus", VERSUS_DEAL, STRONG_NIGHT_SALES, 1_128_800],
    ["versus", VERSUS_DEAL, WEAK_NIGHT_SALES, 1_000_000],
    ["guarantee plus", GUARANTEE_PLUS_DEAL, STRONG_NIGHT_SALES, 1_074_800],
    ["guarantee plus", GUARANTEE_PLUS_DEAL, WEAK_NIGHT_SALES, 1_000_000],
  ])("%s → %i", (_name, deal, sales, expectedPayoutCents) => {
    expect(computeSettlement(hall9Input(sales, deal)).payoutCents).toBe(expectedPayoutCents);
  });
});

describe("computeSettlement: the full strong night, versus + cumulative bonus", () => {
  const result = computeSettlement(
    hall9Input(STRONG_NIGHT_SALES, VERSUS_DEAL, hall9BonusPlan("cumulative")),
  );

  it("pays 1,128,800 + 125,000 = 1,253,800 (docs/domain.md §8)", () => {
    expect(result.payoutCents).toBe(1_253_800);
  });

  it("lists every step in order: box office → expenses → deal → bonus → total", () => {
    expect(result.lines.map((line) => [line.kind, line.amountCents])).toEqual([
      ["gbor", 2_150_000],
      ["ticket_tax", 172_000],
      ["ticket_fees", 50_000],
      ["nbor", 1_928_000],
      ["expenses_submitted", 710_000],
      ["expense_disallowed", 30_000],
      ["expense_category_cap", 40_000],
      ["expense_total_cap", 40_000],
      ["allowed_expenses", 600_000],
      ["guarantee", 1_000_000],
      ["net_after_expenses", 1_328_000],
      ["percentage_share", 1_128_800],
      ["deal_payout", 1_128_800],
      ["bonus", 50_000],
      ["bonus", 75_000],
      ["total_payout", 1_253_800],
    ]);
  });

  it("the payout component lines add up to the payout", () => {
    const components = result.lines.filter((line) =>
      (PAYOUT_COMPONENT_KINDS as readonly string[]).includes(line.kind),
    );
    const sum = components.reduce((total, line) => total + line.amountCents, 0);
    expect(sum).toBe(result.payoutCents);
  });
});

describe("computeSettlement: other rules", () => {
  it("flat and percentage deals emit no expense lines (expenses are not deducted)", () => {
    for (const deal of [FLAT_DEAL, PERCENTAGE_DEAL]) {
      const kinds = computeSettlement(hall9Input(STRONG_NIGHT_SALES, deal)).lines.map(
        (line) => line.kind,
      );
      expect(kinds).not.toContain("allowed_expenses");
    }
  });

  it("self-check 5: highest-only with 455 paid tickets and 100 comps → bonus 75,000", () => {
    const sales = [
      {
        id: "ts-ga",
        tierName: "GA",
        qtySold: 455,
        comps: 100,
        priceCents: 3500,
        taxCents: 0,
        feeCents: 0,
      },
    ];
    const result = computeSettlement(hall9Input(sales, FLAT_DEAL, hall9BonusPlan("highest_only")));
    expect(result.payoutCents).toBe(1_000_000 + 75_000);
  });

  it("rejects invalid input before computing anything", () => {
    const input = hall9Input(STRONG_NIGHT_SALES, VERSUS_DEAL);
    const broken = {
      ...input,
      terms: { ...input.terms, deal: { ...VERSUS_DEAL, artistShareBps: 12_000 } },
    } as SettlementInput;
    expect(() => computeSettlement(broken)).toThrow(/artistShareBps/);
  });

  it("does not modify its input", () => {
    const input = hall9Input(STRONG_NIGHT_SALES, GUARANTEE_PLUS_DEAL, hall9BonusPlan("cumulative"));
    const before = JSON.stringify(input);
    computeSettlement(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("gives the same result for the same input", () => {
    const input = hall9Input(WEAK_NIGHT_SALES, VERSUS_DEAL, hall9BonusPlan("highest_only"));
    expect(computeSettlement(input)).toEqual(computeSettlement(input));
  });
});

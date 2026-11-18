import type { BonusPlan } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { computeBonus } from "./bonus.js";
import { hall9BonusPlan } from "./test-helpers/domain-examples.js";

const REFS = [{ type: "ticket_sale", id: "ts-ga" }] as const;

describe("computeBonus (docs/domain.md §8)", () => {
  it("strong night, cumulative: 400 and 450 reached → 125,000 on two lines", () => {
    const outcome = computeBonus(hall9BonusPlan("cumulative"), 500, [...REFS]);
    expect(outcome.bonusCents).toBe(125_000);
    expect(outcome.lines.map((line) => line.amountCents)).toEqual([50_000, 75_000]);
    expect(outcome.lines[0]?.clauseRef).toBe("§6");
  });

  it("strong night, highest-only: 75,000", () => {
    expect(computeBonus(hall9BonusPlan("highest_only"), 500, [...REFS]).bonusCents).toBe(75_000);
  });

  it("weak night: no tier reached → 0 and no lines", () => {
    for (const mode of ["cumulative", "highest_only"] as const) {
      const outcome = computeBonus(hall9BonusPlan(mode), 310, [...REFS]);
      expect(outcome).toEqual({ bonusCents: 0, lines: [] });
    }
  });

  it("a tier is reached exactly at its threshold (≥)", () => {
    expect(computeBonus(hall9BonusPlan("highest_only"), 400, [...REFS]).bonusCents).toBe(50_000);
    expect(computeBonus(hall9BonusPlan("highest_only"), 399, [...REFS]).bonusCents).toBe(0);
  });

  it("does not depend on the order of the tiers in the contract", () => {
    const plan = hall9BonusPlan("highest_only");
    const reversed: BonusPlan = { ...plan, tiers: [...plan.tiers].reverse() };
    expect(computeBonus(reversed, 500, [...REFS]).bonusCents).toBe(75_000);
    expect(reversed.tiers[0]?.minTicketsSold).toBe(550); // the input was not re-sorted
  });

  it("no bonus clause → 0", () => {
    expect(computeBonus(null, 500, [...REFS])).toEqual({ bonusCents: 0, lines: [] });
  });
});

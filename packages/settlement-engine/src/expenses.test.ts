import type { Expense } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { computeAllowedExpenses } from "./expenses.js";
import { HALL9_EXPENSES, HALL9_EXPENSE_POLICY } from "./test-helpers/domain-examples.js";

describe("computeAllowedExpenses (docs/domain.md §3)", () => {
  it("domain example: 710,000 submitted → 680,000 → 640,000 → 600,000 allowed", () => {
    const { allowedCents, lines } = computeAllowedExpenses(HALL9_EXPENSES, HALL9_EXPENSE_POLICY);
    expect(allowedCents).toBe(600_000);
    expect(lines.map((line) => [line.kind, line.amountCents])).toEqual([
      ["expenses_submitted", 710_000],
      ["expense_disallowed", 30_000], // office_supplies is not allowed
      ["expense_category_cap", 40_000], // advertising 190,000 → 150,000
      ["expense_total_cap", 40_000], // 640,000 → 600,000
      ["allowed_expenses", 600_000],
    ]);
  });

  it("applies the total cap after the category caps (600,000, not 560,000)", () => {
    // Total cap first would give 680,000 → 600,000, then −40,000 advertising = 560,000.
    const { allowedCents } = computeAllowedExpenses(HALL9_EXPENSES, HALL9_EXPENSE_POLICY);
    expect(allowedCents).not.toBe(560_000);
  });

  it("self-check 4: with a total cap of 700,000 the total cap does not bind → 640,000", () => {
    const policy = { ...HALL9_EXPENSE_POLICY, totalCapCents: 700_000 };
    const { allowedCents, lines } = computeAllowedExpenses(HALL9_EXPENSES, policy);
    expect(allowedCents).toBe(640_000);
    expect(lines.some((line) => line.kind === "expense_total_cap")).toBe(false);
  });

  it("no total cap in the contract → 640,000", () => {
    const policy = { ...HALL9_EXPENSE_POLICY, totalCapCents: null };
    expect(computeAllowedExpenses(HALL9_EXPENSES, policy).allowedCents).toBe(640_000);
  });

  it("drops an expense a reviewer marked disallowed, but keeps pending ones", () => {
    const expenses: Expense[] = [
      { id: "a", category: "catering", amountCents: 50_000, status: "disallowed" },
      { id: "b", category: "catering", amountCents: 20_000, status: "pending" },
    ];
    const { allowedCents, lines } = computeAllowedExpenses(expenses, HALL9_EXPENSE_POLICY);
    expect(allowedCents).toBe(20_000);
    const dropped = lines.find((line) => line.kind === "expense_disallowed");
    expect(dropped?.sourceRefs).toEqual([{ type: "expense", id: "a" }]);
    expect(dropped?.clauseRef).toBeNull(); // a reviewer decision, not a contract clause
  });

  it("does not emit a cap line when a capped category stays under its cap", () => {
    const expenses: Expense[] = [
      { id: "a", category: "advertising", amountCents: 150_000, status: "allowed" },
    ];
    const { allowedCents, lines } = computeAllowedExpenses(expenses, HALL9_EXPENSE_POLICY);
    expect(allowedCents).toBe(150_000);
    expect(lines.some((line) => line.kind === "expense_category_cap")).toBe(false);
  });

  it("caps the sum of a category, not each expense on its own", () => {
    const expenses: Expense[] = [
      { id: "a", category: "advertising", amountCents: 100_000, status: "allowed" },
      { id: "b", category: "advertising", amountCents: 100_000, status: "allowed" },
    ];
    const { allowedCents, lines } = computeAllowedExpenses(expenses, HALL9_EXPENSE_POLICY);
    expect(allowedCents).toBe(150_000);
    const capLine = lines.find((line) => line.kind === "expense_category_cap");
    expect(capLine?.amountCents).toBe(50_000);
    expect(capLine?.sourceRefs).toEqual([
      { type: "expense", id: "a" },
      { type: "expense", id: "b" },
    ]);
  });

  it("no expenses → 0 allowed", () => {
    expect(computeAllowedExpenses([], HALL9_EXPENSE_POLICY).allowedCents).toBe(0);
  });
});

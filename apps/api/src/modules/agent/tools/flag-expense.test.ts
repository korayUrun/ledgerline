import { describe, expect, it, vi } from "vitest";
import { ToolError } from "../agent-loop.js";
import { flagExpenseTool, type FlagExpense } from "./flag-expense.js";
import { auditContextFixture } from "./test-fixture.js";

const INPUT = {
  expenseId: "ex-toner",
  kind: "category_not_allowed" as const,
  reason: "office_supplies is not an allowed category (§5).",
};

describe("flag_expense", () => {
  it("opens the flag through the function it was given", async () => {
    const flagExpense = vi.fn<FlagExpense>().mockResolvedValue({ flagId: "f-1", created: true });

    const output = await flagExpenseTool(auditContextFixture(), flagExpense).run(INPUT);

    expect(flagExpense).toHaveBeenCalledWith(INPUT);
    expect(output).toEqual({
      flagId: "f-1",
      created: true,
      result: "Flag opened. A person will review it.",
    });
  });

  it("tells the model when the flag already existed", async () => {
    const flagExpense = vi.fn<FlagExpense>().mockResolvedValue({ flagId: "f-1", created: false });

    const output = await flagExpenseTool(auditContextFixture(), flagExpense).run(INPUT);

    expect(output).toMatchObject({ created: false });
  });

  it("refuses an expense from outside the settlement without calling the service", async () => {
    const flagExpense = vi.fn<FlagExpense>();

    const call = flagExpenseTool(auditContextFixture(), flagExpense).run({
      ...INPUT,
      expenseId: "ex-from-another-show",
    });

    await expect(call).rejects.toBeInstanceOf(ToolError);
    expect(flagExpense).not.toHaveBeenCalled();
  });

  it("only accepts the known flag kinds and a bounded reason", () => {
    const { inputSchema } = flagExpenseTool(auditContextFixture(), vi.fn<FlagExpense>());

    expect(inputSchema.safeParse({ ...INPUT, kind: "approve_payout" }).success).toBe(false);
    expect(inputSchema.safeParse({ ...INPUT, reason: "" }).success).toBe(false);
    expect(inputSchema.safeParse({ ...INPUT, reason: "x".repeat(501) }).success).toBe(false);
  });
});

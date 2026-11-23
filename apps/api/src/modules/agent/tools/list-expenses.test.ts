import { describe, expect, it } from "vitest";
import { listExpensesTool } from "./list-expenses.js";
import { auditContextFixture } from "./test-fixture.js";

describe("list_expenses", () => {
  it("returns every expense with its description, status and receipt", async () => {
    const output = await listExpensesTool(auditContextFixture()).run({});

    expect(output).toEqual({
      expenses: [
        {
          id: "ex-crew",
          category: "production",
          description: "Stage crew, 6 people",
          amount: "$2,800.00",
          status: "allowed",
          hasReceipt: true,
        },
        {
          id: "ex-toner",
          category: "office_supplies",
          description: "Printer toner",
          amount: "$90.00",
          status: "pending",
          hasReceipt: false,
        },
      ],
    });
  });

  it("still lists an expense whose row was deleted after the compute", async () => {
    const context = auditContextFixture();
    context.expenses = context.expenses.filter((expense) => expense.id !== "ex-toner");

    const output = (await listExpensesTool(context).run({})) as {
      expenses: { id: string; description: string | null }[];
    };

    // The engine computed with it, so the agent must see it.
    expect(output.expenses[1]).toMatchObject({ id: "ex-toner", description: null });
  });
});

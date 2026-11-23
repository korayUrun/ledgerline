import { describe, expect, it } from "vitest";
import { ToolError } from "../agent-loop.js";
import { explainLineTool } from "./explain-line.js";
import { auditContextFixture } from "./test-fixture.js";

// Fixture worksheet: 0 gbor, 5 expense_disallowed (toner), 6 expense_category_cap
// (crew), 8 guarantee. See get-settlement.test.ts for the full list.
describe("explain_line", () => {
  it("returns a box office line with the ticket tiers behind it", async () => {
    const output = await explainLineTool(auditContextFixture()).run({ position: 0 });

    expect(output).toEqual({
      position: 0,
      kind: "gbor",
      label: "Gross box office receipts (GBOR)",
      amount: "$14,000.00",
      clauseRef: null,
      ticketSales: [
        {
          id: "ts-ga",
          tierName: "GA",
          qtySold: 400,
          comps: 20,
          price: "$35.00",
          tax: "$1,120.00",
          fees: "$400.00",
        },
      ],
      expenses: [],
    });
  });

  it("returns an expense line with the expenses it removed, descriptions included", async () => {
    const output = await explainLineTool(auditContextFixture()).run({ position: 5 });

    expect(output).toMatchObject({
      kind: "expense_disallowed",
      amount: "$90.00",
      clauseRef: "§5",
      ticketSales: [],
      expenses: [{ id: "ex-toner", description: "Printer toner", amount: "$90.00" }],
    });
  });

  it("returns a deal line with its clause and no source rows", async () => {
    const output = await explainLineTool(auditContextFixture()).run({ position: 8 });

    expect(output).toMatchObject({
      kind: "guarantee",
      clauseRef: "§4.1",
      ticketSales: [],
      expenses: [],
    });
  });

  it("tells the model the valid range when the position does not exist", () => {
    const tool = explainLineTool(auditContextFixture());

    const call = () => tool.run({ position: 99 });

    expect(call).toThrow(ToolError);
    expect(call).toThrow("Positions go from 0 to 12");
  });
});

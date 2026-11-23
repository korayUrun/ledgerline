import { describe, expect, it } from "vitest";
import { getSettlementTool } from "./get-settlement.js";
import { auditContextFixture } from "./test-fixture.js";

describe("get_settlement", () => {
  it("returns the payout and every line in worksheet order, money as dollar text", async () => {
    const output = await getSettlementTool(auditContextFixture()).run({});

    expect(output).toMatchObject({ status: "computed", version: 1, payout: "$10,000.00" });
    const { lines } = output as { lines: { position: number; kind: string }[] };
    expect(lines.map((line) => line.kind)).toEqual([
      "gbor",
      "ticket_tax",
      "ticket_fees",
      "nbor",
      "expenses_submitted",
      "expense_disallowed",
      "expense_category_cap",
      "allowed_expenses",
      "guarantee",
      "net_after_expenses",
      "percentage_share",
      "deal_payout",
      "total_payout",
    ]);
    // The position is what explain_line takes, so it must be the line's index.
    expect(lines.map((line) => line.position)).toEqual(lines.map((_, index) => index));
    expect(lines[5]).toEqual({
      position: 5,
      kind: "expense_disallowed",
      label: "Less: office_supplies is not an allowed category",
      amount: "$90.00",
      clauseRef: "§5",
    });
  });

  it("never sends the model a raw cents number", async () => {
    const output = await getSettlementTool(auditContextFixture()).run({});

    // 1_000_000 cents would be easy to misread as one million dollars.
    expect(JSON.stringify(output)).not.toMatch(/Cents/);
  });
});

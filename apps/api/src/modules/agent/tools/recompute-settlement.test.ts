import { describe, expect, it } from "vitest";
import { ToolError } from "../agent-loop.js";
import { recomputeSettlementTool } from "./recompute-settlement.js";
import { auditContextFixture } from "./test-fixture.js";

describe("recompute_settlement", () => {
  it("reproduces the stored payout when nothing changes", async () => {
    const output = await recomputeSettlementTool(auditContextFixture()).run({
      disallowExpenseIds: [],
    });

    expect(output).toMatchObject({
      storedPayout: "$10,000.00",
      recomputedPayout: "$10,000.00",
      payoutChange: "$0.00",
    });
  });

  it("answers a what-if with the engine and reports the change", async () => {
    // With no guarantee, the versus deal pays 85% of (NBOR − allowed expenses), so
    // the expenses move the payout: 85% × ($12,480 − $2,500 capped crew) = $8,483.
    const context = auditContextFixture();
    context.input.terms.deal = {
      type: "versus",
      guaranteeCents: 0,
      artistShareBps: 8_500,
      clauseRef: "§4.1",
    };
    context.settlement.payoutCents = 848_300;

    const output = await recomputeSettlementTool(context).run({
      disallowExpenseIds: ["ex-crew"],
    });

    // Without the crew no expenses are left: 85% × $12,480 = $10,608.
    expect(output).toMatchObject({
      disallowedExpenseIds: ["ex-crew"],
      storedPayout: "$8,483.00",
      recomputedPayout: "$10,608.00",
      payoutChange: "+$2,125.00",
    });
  });

  it("shows a payout that goes down with a minus sign", async () => {
    // Stored as if the crew had been disallowed; the what-if counts it again.
    const context = auditContextFixture();
    context.input.terms.deal = {
      type: "versus",
      guaranteeCents: 0,
      artistShareBps: 8_500,
      clauseRef: "§4.1",
    };
    context.settlement.payoutCents = 1_060_800;

    const output = await recomputeSettlementTool(context).run({ disallowExpenseIds: [] });

    expect(output).toMatchObject({ recomputedPayout: "$8,483.00", payoutChange: "-$2,125.00" });
  });

  it("saves nothing: the context the other tools read is unchanged", async () => {
    const context = auditContextFixture();
    const before = structuredClone(context);

    await recomputeSettlementTool(context).run({ disallowExpenseIds: ["ex-crew"] });

    expect(context).toEqual(before);
  });

  it("refuses an expense id that is not in this settlement", () => {
    const tool = recomputeSettlementTool(auditContextFixture());

    const call = () => tool.run({ disallowExpenseIds: ["ex-toner", "ex-from-another-show"] });

    expect(call).toThrow(ToolError);
    expect(call).toThrow("Unknown expense id(s): ex-from-another-show");
  });
});

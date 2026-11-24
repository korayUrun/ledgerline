import { describe, expect, it } from "vitest";
import { ToolError } from "../agent-loop.js";
import { getShowProgressTool } from "./get-show-progress.js";
import { workspaceContextFixture } from "./workspace-fixture.js";

describe("get_show_progress", () => {
  it("returns the steps, the next action and the facts, with the payout as dollar text", async () => {
    const output = await getShowProgressTool(workspaceContextFixture()).run({
      showId: "show-harbor",
    });

    expect(output).toMatchObject({
      show: { showId: "show-harbor", artist: "The Harbor Lights" },
      currentStep: 4,
      nextAction: "Allow or disallow the 2 pending expense(s), then recompute.",
      facts: {
        pendingExpenses: 2,
        contractStatus: "confirmed",
        termsVersion: 1,
        settlement: { status: "computed", version: 4, payout: "$9,430.40" },
      },
    });
  });

  it("says plainly when there is no contract or settlement yet", async () => {
    const tool = getShowProgressTool(workspaceContextFixture());

    const bloom = await tool.run({ showId: "show-bloom" });
    const drill = await tool.run({ showId: "show-drill" });

    expect(bloom).toMatchObject({ facts: { settlement: null, contractStatus: "needs_review" } });
    expect(drill).toMatchObject({ facts: { contractStatus: "no contract uploaded" } });
  });

  it("answers an unknown id with an error the model can act on", () => {
    const tool = getShowProgressTool(workspaceContextFixture());

    expect(() => tool.run({ showId: "made-up" })).toThrow(ToolError);
    expect(() => tool.run({ showId: "made-up" })).toThrow(/Call list_shows/);
  });
});

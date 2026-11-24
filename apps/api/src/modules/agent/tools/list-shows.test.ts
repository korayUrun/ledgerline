import { describe, expect, it } from "vitest";
import { listShowsTool } from "./list-shows.js";
import { workspaceContextFixture } from "./workspace-fixture.js";

type Output = {
  totalShows: number;
  matching: number;
  shows: { showId: string; settlementStatus: string; currentStep: string; nextAction: string }[];
};

describe("list_shows", () => {
  it("lists every show with its step and next action when there is no search", async () => {
    const output = (await listShowsTool(workspaceContextFixture()).run({})) as Output;

    expect(output.totalShows).toBe(3);
    expect(output.matching).toBe(3);
    expect(output.shows[0]).toMatchObject({
      showId: "show-harbor",
      settlementStatus: "computed",
      currentStep: "Step 4 of 4: Settlement",
      nextAction: "Allow or disallow the 2 pending expense(s), then recompute.",
    });
    // A show without a settlement row reads as "not started", never null.
    expect(output.shows[1]).toMatchObject({
      showId: "show-bloom",
      settlementStatus: "not started",
      currentStep: "Step 1 of 4: Sales & expenses",
    });
  });

  it("finds a show by part of its name, artist or venue, in any case", async () => {
    const tool = listShowsTool(workspaceContextFixture());

    const byName = (await tool.run({ search: "harbor" })) as Output;
    const byVenue = (await tool.run({ search: "VELVET" })) as Output;
    const none = (await tool.run({ search: "no such show" })) as Output;

    expect(byName.shows.map((show) => show.showId)).toEqual(["show-harbor"]);
    expect(byVenue.matching).toBe(2);
    expect(none).toMatchObject({ totalShows: 3, matching: 0, shows: [] });
  });
});

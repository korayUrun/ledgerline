import { describe, expect, it } from "vitest";
import { listTicketSalesTool } from "./list-ticket-sales.js";
import { auditContextFixture } from "./test-fixture.js";

describe("list_ticket_sales", () => {
  it("returns each tier with counts as numbers and money as text", async () => {
    const output = await listTicketSalesTool(auditContextFixture()).run({});

    expect(output).toEqual({
      tiers: [
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
    });
  });
});

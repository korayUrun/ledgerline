import type { WorkspaceContext } from "../workspace/workspace-context.js";

// Three shows at different points of the flow, for the workspace tool tests.
export function workspaceContextFixture(): WorkspaceContext {
  return {
    shows: [
      {
        id: "show-harbor",
        name: "The Harbor Lights — Fall Tour",
        showDate: "2026-11-06",
        artistName: "The Harbor Lights",
        venueName: "The Velvet Room",
        ticketTierCount: 2,
        expenseCount: 5,
        pendingExpenseCount: 2,
        openFlagCount: 0,
        latestContractStatus: "confirmed",
        termsVersion: 1,
        settlement: { status: "computed", version: 4, payoutCents: 943_040 },
      },
      {
        id: "show-bloom",
        name: "Static Bloom — Album Release",
        showDate: "2026-11-14",
        artistName: "Static Bloom",
        venueName: "The Velvet Room",
        ticketTierCount: 0,
        expenseCount: 0,
        pendingExpenseCount: 0,
        openFlagCount: 0,
        latestContractStatus: "needs_review",
        termsVersion: null,
        settlement: null,
      },
      {
        id: "show-drill",
        name: "Stripe Drill 1+3",
        showDate: "2026-11-21",
        artistName: "Stripe Test Band",
        venueName: "Stripe Drill Hall",
        ticketTierCount: 1,
        expenseCount: 0,
        pendingExpenseCount: 0,
        openFlagCount: 0,
        latestContractStatus: null,
        termsVersion: 1,
        settlement: { status: "paid", version: 1, payoutCents: 15_000 },
      },
    ],
  };
}

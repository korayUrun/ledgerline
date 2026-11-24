import { describe, expect, it } from "vitest";
import { showProgress } from "./show-progress.js";
import type { WorkspaceShow } from "./workspace-context.js";

// A show with nothing done yet; each test changes what it needs.
function show(overrides: Partial<WorkspaceShow> = {}): WorkspaceShow {
  return {
    id: "show-1",
    name: "Test Night",
    showDate: "2026-11-06",
    artistName: "Test Band",
    venueName: "Test Hall",
    ticketTierCount: 0,
    expenseCount: 0,
    pendingExpenseCount: 0,
    openFlagCount: 0,
    latestContractStatus: null,
    termsVersion: null,
    settlement: null,
    ...overrides,
  };
}

const ready = {
  ticketTierCount: 2,
  latestContractStatus: "confirmed" as const,
  termsVersion: 1,
};

const states = (input: WorkspaceShow) => showProgress(input).steps.map((step) => step.state);

describe("showProgress", () => {
  it("starts at step 1 with the import as the next action", () => {
    const progress = showProgress(show());

    expect(progress.currentStep).toBe(1);
    expect(states(show())).toEqual(["not_started", "not_started", "not_started", "not_started"]);
    expect(progress.nextAction).toMatch(/Import the ticket sales CSV/);
  });

  it("moves to the contract once sales are in", () => {
    const progress = showProgress(show({ ticketTierCount: 2 }));

    expect(progress.currentStep).toBe(2);
    expect(progress.nextAction).toMatch(/Upload the contract PDF/);
  });

  it("asks for a review while extracted terms wait for a person", () => {
    const input = show({ ticketTierCount: 2, latestContractStatus: "needs_review" });

    expect(states(input)[1]).toBe("needs_attention");
    expect(showProgress(input).nextAction).toMatch(/Review the extracted deal terms/);
  });

  it("counts terms typed in by hand as a finished contract step", () => {
    const input = show({ ticketTierCount: 2, termsVersion: 1 });

    expect(states(input).slice(0, 3)).toEqual(["done", "done", "done"]);
    expect(showProgress(input).currentStep).toBe(4);
    expect(showProgress(input).nextAction).toBe("Compute the settlement.");
  });

  it("asks to decide pending expenses before anything else on a computed settlement", () => {
    const input = show({
      ...ready,
      pendingExpenseCount: 2,
      openFlagCount: 1,
      settlement: { status: "computed", version: 1, payoutCents: 943_040 },
    });

    expect(states(input)[3]).toBe("needs_attention");
    expect(showProgress(input).nextAction).toMatch(/2 pending expense\(s\)/);
  });

  it("asks to resolve open flags, then to submit for review", () => {
    const flagged = show({
      ...ready,
      openFlagCount: 1,
      settlement: { status: "computed", version: 1, payoutCents: 1 },
    });
    const clean = show({
      ...ready,
      settlement: { status: "computed", version: 1, payoutCents: 1 },
    });

    expect(showProgress(flagged).nextAction).toMatch(/1 open assistant flag\(s\)/);
    expect(showProgress(clean).nextAction).toBe("Submit the settlement for review.");
    expect(states(clean)[3]).toBe("in_progress");
  });

  it("asks for a recompute on a stale settlement", () => {
    const input = show({ ...ready, settlement: { status: "stale", version: 2, payoutCents: 1 } });

    expect(states(input)[3]).toBe("needs_attention");
    expect(showProgress(input).nextAction).toMatch(/Recompute the settlement/);
  });

  it("leaves approval to a person while in review", () => {
    const input = show({
      ...ready,
      settlement: { status: "in_review", version: 1, payoutCents: 1 },
    });

    expect(showProgress(input).nextAction).toMatch(/A person checks the worksheet/);
  });

  it("locks steps 1–3 once approved, and is done when paid", () => {
    const paying = show({ ...ready, settlement: { status: "paying", version: 1, payoutCents: 1 } });
    const paid = show({ ...ready, settlement: { status: "paid", version: 1, payoutCents: 1 } });
    const failed = show({
      ...ready,
      settlement: { status: "payment_failed", version: 1, payoutCents: 1 },
    });

    expect(states(paying)).toEqual(["locked", "locked", "locked", "in_progress"]);
    expect(showProgress(paying).currentStep).toBe(4);
    expect(states(paid)[3]).toBe("done");
    expect(showProgress(paid).nextAction).toMatch(/artist has been paid/);
    expect(states(failed)[3]).toBe("needs_attention");
    expect(showProgress(failed).nextAction).toMatch(/Retry it/);
  });
});

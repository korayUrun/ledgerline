import { SettlementStatusSchema } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { canTransition, SETTLEMENT_TRANSITIONS } from "./settlement-state-machine.js";

// The table itself is the specification, so these tests read it back as plain
// sentences. The database side (compare-and-set, audit row in the same
// transaction) is covered by the integration tests in test/.
describe("settlement transitions", () => {
  it.each([
    ["draft", "computed"],
    ["computed", "computed"],
    ["computed", "in_review"],
    ["computed", "stale"],
    ["in_review", "stale"],
    ["stale", "computed"],
    ["in_review", "approved"],
    ["approved", "paying"],
    ["approved", "paid"], // nothing to pay
    ["paying", "paid"],
    ["paying", "payment_failed"],
    ["payment_failed", "paying"], // a person retries
  ] as const)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["draft", "in_review"], // review needs a computed result
    ["draft", "stale"], // nothing computed, so nothing to invalidate
    ["stale", "in_review"], // must recompute first
    ["in_review", "computed"], // goes stale first if its inputs changed
    ["in_review", "draft"],
    ["computed", "approved"], // approval needs a review first
    ["in_review", "paying"], // paying only after an approval
    ["approved", "stale"], // approved inputs are locked
    ["paying", "stale"],
    ["paying", "computed"], // no recompute while money is moving
    ["payment_failed", "paid"], // only a payout that arrives makes it paid
    ["paid", "paying"], // paid is final: never pay twice
    ["paid", "computed"],
  ] as const)("refuses %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("covers every status", () => {
    expect(Object.keys(SETTLEMENT_TRANSITIONS).sort()).toEqual(
      [...SettlementStatusSchema.options].sort(),
    );
  });
});

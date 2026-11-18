import { ContractStatusSchema } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { canTransitionContract, CONTRACT_TRANSITIONS } from "./contract-state-machine.js";

// The table is the specification (docs/SYSTEM.md §5). The database side
// (compare-and-set, audit row in the same transaction) is covered in test/.
describe("contract transitions", () => {
  it.each([
    ["uploaded", "extracting"],
    ["extracting", "needs_review"],
    ["extracting", "failed"],
    ["needs_review", "confirmed"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(canTransitionContract(from, to)).toBe(true);
  });

  it.each([
    ["uploaded", "needs_review"], // must be extracted first
    ["uploaded", "confirmed"], // nobody can confirm what was never read
    ["needs_review", "extracting"], // no re-extraction in place: upload again
    ["confirmed", "needs_review"], // confirmed terms are a version; edit them as a new one
    ["failed", "extracting"], // a failed contract is re-uploaded, not retried in place
  ] as const)("refuses %s → %s", (from, to) => {
    expect(canTransitionContract(from, to)).toBe(false);
  });

  it("covers every status, and confirmed and failed are final", () => {
    expect(Object.keys(CONTRACT_TRANSITIONS).sort()).toEqual(
      [...ContractStatusSchema.options].sort(),
    );
    expect(CONTRACT_TRANSITIONS.confirmed).toEqual([]);
    expect(CONTRACT_TRANSITIONS.failed).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { precisionRecall, scoreFlags } from "./score-flags.js";

const PLANTED = [
  { expenseId: "ex-2", kind: "over_category_cap" as const },
  { expenseId: "ex-5", kind: "category_not_allowed" as const },
];

describe("scoreFlags", () => {
  it("sorts flagged expenses into found, wrong and missed", () => {
    const score = scoreFlags(PLANTED, [
      { expenseId: "ex-5", kind: "category_not_allowed" },
      { expenseId: "ex-1", kind: "other" },
    ]);

    expect(score).toEqual({
      truePositives: ["ex-5"],
      falsePositives: ["ex-1"],
      falseNegatives: ["ex-2"],
      rightKind: 1,
    });
  });

  it("counts an expense once, and a found expense with the wrong kind as found", () => {
    const score = scoreFlags(PLANTED, [
      { expenseId: "ex-2", kind: "other" },
      { expenseId: "ex-2", kind: "category_not_allowed" },
    ]);

    expect(score.truePositives).toEqual(["ex-2"]);
    expect(score.rightKind).toBe(0);
  });
});

describe("precisionRecall", () => {
  it("adds the counts over all cases", () => {
    const totals = precisionRecall([
      scoreFlags(PLANTED, [{ expenseId: "ex-2", kind: "over_category_cap" }]),
      scoreFlags([], [{ expenseId: "ex-9", kind: "other" }]),
    ]);

    expect(totals).toEqual({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 1,
      rightKind: 1,
    });
  });
});

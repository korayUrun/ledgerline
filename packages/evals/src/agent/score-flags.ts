import type { EvalCase } from "../dataset.js";

export type RaisedFlag = { expenseId: string; kind: string };

export type FlagScore = {
  truePositives: string[]; // planted violations the agent flagged (expense ids)
  falsePositives: string[]; // flagged expenses that break no rule
  falseNegatives: string[]; // planted violations the agent missed
  // Of the true positives, how many had the right kind (category_not_allowed vs
  // over_category_cap). Reported apart: finding the expense is what matters most.
  rightKind: number;
};

// Scores by expense: an expense counts once however many flags it got. A flag of
// another kind on a planted expense still finds the problem (rightKind tells them
// apart).
export function scoreFlags(planted: EvalCase["plantedViolations"], flags: RaisedFlag[]): FlagScore {
  const plantedById = new Map(planted.map((violation) => [violation.expenseId, violation.kind]));
  const flaggedIds = [...new Set(flags.map((flag) => flag.expenseId))];
  const truePositives = flaggedIds.filter((id) => plantedById.has(id));
  const rightKind = truePositives.filter((id) =>
    flags.some((flag) => flag.expenseId === id && flag.kind === plantedById.get(id)),
  ).length;
  return {
    truePositives,
    falsePositives: flaggedIds.filter((id) => !plantedById.has(id)),
    falseNegatives: [...plantedById.keys()].filter((id) => !flaggedIds.includes(id)),
    rightKind,
  };
}

// Precision = of what was flagged, how much was right. Recall = of what was
// planted, how much was found. Over all cases at once (micro-average), so a case
// with three violations weighs more than a case with one.
export function precisionRecall(scores: FlagScore[]): {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  rightKind: number;
} {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let rightKind = 0;
  for (const score of scores) {
    truePositives += score.truePositives.length;
    falsePositives += score.falsePositives.length;
    falseNegatives += score.falseNegatives.length;
    rightKind += score.rightKind;
  }
  return { truePositives, falsePositives, falseNegatives, rightKind };
}

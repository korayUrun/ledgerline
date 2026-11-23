import type { AuditContext } from "@ledgerline/api";
import { computeSettlement } from "@ledgerline/settlement-engine";
import type { EvalCase } from "../dataset.js";

// One dataset case as the agent's tools see it. The terms are the ground truth,
// not an extraction: this eval measures the agent's judgment on correct terms, so
// an extraction mistake cannot show up as an agent mistake.
export function contextFromCase(evalCase: EvalCase): AuditContext {
  const input = {
    terms: evalCase.terms,
    ticketSales: evalCase.ticketSales,
    // The engine's view of the expenses: no descriptions.
    expenses: evalCase.expenses.map(({ id, category, amountCents, status }) => ({
      id,
      category,
      amountCents,
      status,
    })),
  };
  const result = computeSettlement(input);
  return {
    settlement: {
      id: `eval-${evalCase.id}`,
      status: "computed",
      version: 1,
      termsVersion: 1,
      payoutCents: result.payoutCents,
      computedAt: `${evalCase.parties.showDate}T23:00:00.000Z`,
    },
    input,
    lines: result.lines,
    expenses: evalCase.expenses.map((expense) => ({ ...expense, hasReceipt: true })),
    extraction: null,
  };
}

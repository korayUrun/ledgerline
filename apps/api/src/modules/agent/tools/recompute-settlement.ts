import { formatCents, type SettlementInput } from "@ledgerline/schemas";
import { computeSettlement } from "@ledgerline/settlement-engine";
import { z } from "zod";
import { ToolError, type AgentTool } from "../agent-loop.js";
import type { AuditContext } from "./audit-context.js";

const RecomputeSettlementInputSchema = z.object({
  disallowExpenseIds: z
    .array(z.string().min(1))
    .max(50)
    .describe("Expenses to treat as disallowed in this what-if; [] recomputes the data as it is"),
});

export function recomputeSettlementTool(
  context: AuditContext,
): AgentTool<typeof RecomputeSettlementInputSchema> {
  return {
    name: "recompute_settlement",
    description:
      'Runs the settlement engine again on the same inputs, optionally with some expenses treated as disallowed, and returns the new payout, the change against the stored payout, and the new worksheet lines. Nothing is saved: it is a what-if. Use it whenever you need a number that is not on the worksheet, e.g. "what would the payout be without this expense?", or to confirm the stored payout (pass []). Never add, subtract or multiply amounts yourself; ask this tool.',
    inputSchema: RecomputeSettlementInputSchema,
    run({ disallowExpenseIds }) {
      const known = new Set(context.input.expenses.map((expense) => expense.id));
      const unknown = disallowExpenseIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new ToolError(
          `Unknown expense id(s): ${unknown.join(", ")}. Use the ids from list_expenses.`,
        );
      }

      // A changed copy: the context (what the other tools read) stays as it was.
      const disallowed = new Set(disallowExpenseIds);
      const whatIf: SettlementInput = {
        ...context.input,
        expenses: context.input.expenses.map((expense) =>
          disallowed.has(expense.id) ? { ...expense, status: "disallowed" } : expense,
        ),
      };
      // The pure engine, the same function the compute endpoint runs.
      const result = computeSettlement(whatIf);
      // Integer cents, no rounding: the difference is exact.
      const changeCents = result.payoutCents - context.settlement.payoutCents;

      return {
        disallowedExpenseIds: [...disallowed],
        storedPayout: formatCents(context.settlement.payoutCents),
        recomputedPayout: formatCents(result.payoutCents),
        // "+$90.00", "-$90.00" or "$0.00": the sign says which way the payout moves.
        payoutChange: (changeCents > 0 ? "+" : "") + formatCents(changeCents),
        lines: result.lines.map((line, position) => ({
          position,
          kind: line.kind,
          label: line.label,
          amount: formatCents(line.amountCents),
          clauseRef: line.clauseRef,
        })),
      };
    },
  };
}

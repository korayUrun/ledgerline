import { ExpenseFlagKindSchema, type ExpenseFlagKind } from "@ledgerline/schemas";
import { z } from "zod";
import { ToolError, type AgentTool } from "../agent-loop.js";
import type { AuditContext } from "./audit-context.js";

const FlagExpenseInputSchema = z.object({
  expenseId: z.string().min(1).describe("An expense id from list_expenses"),
  kind: ExpenseFlagKindSchema.describe(
    "category_not_allowed: the contract does not allow this category. over_category_cap: the category's expenses exceed its cap. other: anything else, explained in reason.",
  ),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe("One or two sentences a person can check, citing the contract clause"),
});

// Opens the flag and says whether it is new. The tool does not write to the
// database itself: the API passes ExpenseFlagsService (which checks the expense is
// in this run's show and writes the audit log), the eval passes an in-memory list.
export type FlagExpense = (input: {
  expenseId: string;
  kind: ExpenseFlagKind;
  reason: string;
}) => Promise<{ flagId: string; created: boolean }>;

export function flagExpenseTool(
  context: AuditContext,
  flagExpense: FlagExpense,
): AgentTool<typeof FlagExpenseInputSchema> {
  return {
    name: "flag_expense",
    description:
      "Flags one expense for a person to review, with the kind of problem and a short reason. A flag is a note only: it does not change the expense, its status or the payout, and a person decides whether to act on it. Flag an expense only when the contract terms show a concrete problem (a category the contract does not allow, a category over its cap, or a description that clearly does not fit its category). Flagging the same expense twice for the same kind does not create a second flag.",
    inputSchema: FlagExpenseInputSchema,
    async run(input) {
      // Checked here too, so the model gets an error it can fix (wrong id) instead
      // of a failed run. The service checks again: this check is for the model,
      // that one is the actual guard.
      if (!context.expenses.some((expense) => expense.id === input.expenseId)) {
        throw new ToolError(
          `There is no expense ${input.expenseId} in this settlement. Use the ids from list_expenses.`,
        );
      }
      const { flagId, created } = await flagExpense(input);
      return {
        flagId,
        created,
        result: created
          ? "Flag opened. A person will review it."
          : "This expense already has an open flag of this kind; no new flag was created.",
      };
    },
  };
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ExpenseFlagKindSchema, V1ExpenseFlagSchema } from "@ledgerline/schemas";
import { z } from "zod";
import type { LedgerlineApi } from "../api-client.js";
import { runTool } from "./tool-result.js";

// flag_expense → POST /v1/expenses/:id/flags. The only tool that writes, and what it
// writes is a note for a person: it never changes the expense or the payout. A person
// accepts or dismisses the flag in the web app. There is no tool to approve or pay,
// and the API key could not do it anyway (those routes need a logged-in person).

export const FlagExpenseInputSchema = z.object({
  expenseId: z.uuid().describe("The expense id, from explain_settlement_line (expenses[].id)"),
  kind: ExpenseFlagKindSchema.describe(
    "category_not_allowed: the contract does not allow this category. over_category_cap: the category's expenses exceed its cap. other: anything else, explained in reason.",
  ),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("One or two sentences a person can check, citing the contract clause"),
});

export const FlagExpenseOutputSchema = V1ExpenseFlagSchema;

export function registerFlagExpense(server: McpServer, api: LedgerlineApi): void {
  server.registerTool(
    "flag_expense",
    {
      title: "Flag an expense for review",
      description:
        "Opens a flag on one expense for a person to accept or dismiss in Ledgerline. A flag is a note only: it does not change the expense, its status or the payout. Flag only when the contract terms show a concrete problem, and only when the user asks you to. Flagging the same expense with the same kind again returns the existing open flag (created: false). Refused once the settlement is approved.",
      inputSchema: FlagExpenseInputSchema,
      outputSchema: FlagExpenseOutputSchema,
      // Not read-only (it writes a note), but not destructive, and repeating it is
      // harmless (the API returns the same open flag): idempotent.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ expenseId, kind, reason }) =>
      runTool(() =>
        api.post(`/v1/expenses/${expenseId}/flags`, { kind, reason }, V1ExpenseFlagSchema),
      ),
  );
}

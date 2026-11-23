import { formatCents } from "@ledgerline/schemas";
import { z } from "zod";
import { ToolError, type AgentTool } from "../agent-loop.js";
import { expenseAsText, ticketSaleAsText } from "./as-text.js";
import type { AuditContext } from "./audit-context.js";

const ExplainLineInputSchema = z.object({
  position: z.int().min(0).describe("The line's position, as returned by get_settlement"),
});

export function explainLineTool(context: AuditContext): AgentTool<typeof ExplainLineInputSchema> {
  return {
    name: "explain_line",
    description:
      "Returns one worksheet line with the input rows it was computed from: the ticket tiers behind a box office line, or the expenses behind an expense line. Use it to explain where a number comes from, or to see which expenses a cap or a disallowed line removed. Lines that come from the deal (guarantee, percentage share, payout) have no source rows; their clauseRef points to the contract clause instead (see get_contract_terms).",
    inputSchema: ExplainLineInputSchema,
    run({ position }) {
      const line = context.lines[position];
      if (!line) {
        // The model can fix this one: it gets the valid range and can ask again.
        throw new ToolError(
          `There is no line at position ${position}. Positions go from 0 to ${context.lines.length - 1}.`,
        );
      }

      const salesById = new Map(context.input.ticketSales.map((sale) => [sale.id, sale]));
      const expensesById = new Map(context.input.expenses.map((expense) => [expense.id, expense]));
      const detailsById = new Map(context.expenses.map((expense) => [expense.id, expense]));
      // The engine wrote these refs from the same input, so every id is there.
      // A missing one would mean the stored lines and snapshot disagree: a bug,
      // not something the model can fix, so it ends the run.
      const lookUp = <T>(byId: Map<string, T>, id: string): T => {
        const row = byId.get(id);
        if (!row) throw new Error(`Line ${position} points to ${id}, which is not in the input`);
        return row;
      };

      return {
        position,
        kind: line.kind,
        label: line.label,
        amount: formatCents(line.amountCents),
        clauseRef: line.clauseRef,
        ticketSales: line.sourceRefs
          .filter((ref) => ref.type === "ticket_sale")
          .map((ref) => ticketSaleAsText(lookUp(salesById, ref.id))),
        expenses: line.sourceRefs
          .filter((ref) => ref.type === "expense")
          .map((ref) => expenseAsText(lookUp(expensesById, ref.id), detailsById.get(ref.id))),
      };
    },
  };
}

import type { AgentTool } from "../agent-loop.js";
import type { AuditContext } from "./audit-context.js";
import { explainLineTool } from "./explain-line.js";
import { flagExpenseTool, type FlagExpense } from "./flag-expense.js";
import { getContractTermsTool } from "./get-contract-terms.js";
import { getSettlementTool } from "./get-settlement.js";
import { listExpensesTool } from "./list-expenses.js";
import { listTicketSalesTool } from "./list-ticket-sales.js";
import { recomputeSettlementTool } from "./recompute-settlement.js";

export type { AuditContext, AuditExpense } from "./audit-context.js";
export type { FlagExpense } from "./flag-expense.js";

// Every tool the audit agent has (docs/SYSTEM.md §7.2), built for one run. Six read
// the context; flag_expense is the only write, and it only adds a note for a person.
// There is deliberately no tool to approve, pay, edit terms or change an expense.
export function buildAuditTools(context: AuditContext, flagExpense: FlagExpense): AgentTool[] {
  return [
    getSettlementTool(context),
    getContractTermsTool(context),
    listExpensesTool(context),
    listTicketSalesTool(context),
    explainLineTool(context),
    recomputeSettlementTool(context),
    flagExpenseTool(context, flagExpense),
  ];
}

import { formatCents } from "@ledgerline/schemas";
import { z } from "zod";
import { ToolError, type AgentTool } from "../agent-loop.js";
import { showProgress } from "../workspace/show-progress.js";
import type { WorkspaceContext } from "../workspace/workspace-context.js";

const GetShowProgressInputSchema = z.object({
  showId: z.string().min(1),
});

// One show in detail: the four steps, what to do next, and the facts behind them.
// The step states and the next action are decided by showProgress (code); the
// model only reads them and says them in words.
export function getShowProgressTool(
  context: WorkspaceContext,
): AgentTool<typeof GetShowProgressInputSchema> {
  return {
    name: "get_show_progress",
    description:
      "Returns where one show is in the four-step flow (1 Sales & expenses, 2 Contract, 3 Deal terms, 4 Settlement): each step's state, the current step, the next action for the person, and the facts behind them (ticket tiers, expenses, pending expenses, open assistant flags, contract status, terms version, settlement status, version and payout). Take the showId from list_shows. The payout is dollar text from the settlement engine: quote it as it is.",
    inputSchema: GetShowProgressInputSchema,
    run(input) {
      const show = context.shows.find((candidate) => candidate.id === input.showId);
      if (!show) {
        // An id the model invented or mistyped: it can fix that by calling list_shows.
        throw new ToolError(`There is no show ${input.showId}. Call list_shows to find its id.`);
      }
      const progress = showProgress(show);
      return {
        show: {
          showId: show.id,
          name: show.name,
          date: show.showDate,
          artist: show.artistName,
          venue: show.venueName,
        },
        currentStep: progress.currentStep,
        steps: progress.steps,
        nextAction: progress.nextAction,
        facts: {
          ticketTiers: show.ticketTierCount,
          expenses: show.expenseCount,
          pendingExpenses: show.pendingExpenseCount,
          openAssistantFlags: show.openFlagCount,
          contractStatus: show.latestContractStatus ?? "no contract uploaded",
          termsVersion: show.termsVersion,
          settlement: show.settlement && {
            status: show.settlement.status,
            version: show.settlement.version,
            payout:
              show.settlement.payoutCents === null
                ? null
                : formatCents(show.settlement.payoutCents),
          },
        },
      };
    },
  };
}

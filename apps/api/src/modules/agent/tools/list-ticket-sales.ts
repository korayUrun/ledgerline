import { z } from "zod";
import type { AgentTool } from "../agent-loop.js";
import { ticketSaleAsText } from "./as-text.js";
import type { AuditContext } from "./audit-context.js";

const ListTicketSalesInputSchema = z.object({});

export function listTicketSalesTool(
  context: AuditContext,
): AgentTool<typeof ListTicketSalesInputSchema> {
  return {
    name: "list_ticket_sales",
    description:
      "Returns the ticket sales the settlement was computed from, one entry per ticket tier: tickets sold (paid only), comps (free tickets, counted but bringing in no money), face price per ticket, and the tier's total ticket tax and fees. Use it to answer questions about attendance, bonus thresholds (which count paid tickets only) or the box office lines. Totals such as the gross are on the worksheet (get_settlement); do not compute them yourself.",
    inputSchema: ListTicketSalesInputSchema,
    run() {
      return { tiers: context.input.ticketSales.map(ticketSaleAsText) };
    },
  };
}

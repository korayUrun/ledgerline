import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { V1SettlementSchema } from "@ledgerline/schemas";
import { z } from "zod";
import type { LedgerlineApi } from "../api-client.js";
import { runTool } from "./tool-result.js";

// get_settlement → GET /v1/settlements/:id. The whole worksheet: every line from
// gross box office down to the total payout, plus the payment attempts.

// z.uuid() also keeps the value safe to put in the URL path: nothing but hex digits
// and dashes can get through.
export const GetSettlementInputSchema = z.object({
  settlementId: z.uuid().describe("The settlement id, from list_shows (settlement.id)"),
});

export const GetSettlementOutputSchema = V1SettlementSchema;

export function registerGetSettlement(server: McpServer, api: LedgerlineApi): void {
  server.registerTool(
    "get_settlement",
    {
      title: "Get a settlement",
      description:
        "Returns one settlement: its status, the show, the payout, and the worksheet lines in order (each with a position, label, amount and the contract clause it comes from; the last line is the total payout), plus payment attempts and the number of open expense flags. Use it to answer how a payout was reached. To see where one line's number comes from (ticket tiers, expenses, contract wording), call explain_settlement_line with its position. Status `stale` means the inputs changed after the compute: say the numbers are out of date. Quote `formatted` amounts; never add or subtract them yourself.",
      inputSchema: GetSettlementInputSchema,
      outputSchema: GetSettlementOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ settlementId }) =>
      runTool(() => api.get(`/v1/settlements/${settlementId}`, V1SettlementSchema)),
  );
}

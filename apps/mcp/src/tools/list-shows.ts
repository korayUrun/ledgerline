import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { V1ShowListSchema } from "@ledgerline/schemas";
import { z } from "zod";
import type { LedgerlineApi } from "../api-client.js";
import { runTool } from "./tool-result.js";

// list_shows → GET /v1/shows. The entry point of most questions: it turns "last
// night's show" or "the Friday show" into a settlement id for get_settlement.

// No arguments: the list is short (one venue), newest first.
export const ListShowsInputSchema = z.object({});

// Exactly what the API returns, checked twice: by the API client (is this really
// the Ledgerline API?) and by the SDK (does the result match what we promised?).
export const ListShowsOutputSchema = V1ShowListSchema;

export function registerListShows(server: McpServer, api: LedgerlineApi): void {
  server.registerTool(
    "list_shows",
    {
      title: "List shows",
      description:
        "Lists every show, newest first, with its date, artist, venue and settlement (id, status and payout; null if nothing was computed yet). Use it first to find the settlement id of a show the user mentions, then call get_settlement with that id. Amounts come as { cents, formatted }: quote `formatted`, never compute with them.",
      inputSchema: ListShowsInputSchema,
      outputSchema: ListShowsOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => runTool(() => api.get("/v1/shows", V1ShowListSchema)),
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerlineApi } from "./api-client.js";
import { registerExplainSettlementLine } from "./tools/explain-settlement-line.js";
import { registerFlagExpense } from "./tools/flag-expense.js";
import { registerGetSettlement } from "./tools/get-settlement.js";
import { registerListShows } from "./tools/list-shows.js";

// The Ledgerline MCP server (F10): four tools, each a thin wrapper over one /v1
// route. No transport here (index.ts adds stdio; tests add an in-memory one), so the
// same server runs in Claude Desktop and in the tests.

export const SERVER_NAME = "ledgerline";
export const SERVER_VERSION = "0.1.0";

// Sent to the client in the initialize handshake; clients show it to the model as
// guidance for the whole server, on top of each tool's description.
export const SERVER_INSTRUCTIONS = [
  "Ledgerline settles what a venue pays an artist for a show. Use these tools to read settlements and explain them; the numbers come from Ledgerline's settlement engine.",
  'To answer "why did we pay this artist $X for show Y?": list_shows to find the settlement, get_settlement for the worksheet lines, then explain_settlement_line for the lines that matter, citing the contract clause.',
  "Quote the `formatted` amounts. Never compute amounts yourself (no adding, subtracting or percentages): every number in the answer must come from a tool result.",
  "This server cannot approve or pay a settlement; only a person can, in the Ledgerline web app.",
].join("\n");

export function createServer(api: LedgerlineApi): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerListShows(server, api);
  registerGetSettlement(server, api);
  registerExplainSettlementLine(server, api);
  registerFlagExpense(server, api);
  return server;
}

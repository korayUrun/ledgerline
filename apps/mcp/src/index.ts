import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LedgerlineApi } from "./api-client.js";
import { readConfig, type McpConfig } from "./config.js";
import { createServer } from "./server.js";

// Entry point: `pnpm --filter @ledgerline/mcp start`, normally started by an MCP
// client (Claude Desktop, Claude Code, MCP Inspector), which talks to it over stdio.
//
// stdout is the protocol channel: every byte written there must be a JSON-RPC
// message. Logs go to stderr (console.error), which clients show as the server's log.
// ESLint bans console.log in this package for that reason.

let config: McpConfig;
try {
  config = readConfig();
} catch (error) {
  console.error(`Ledgerline MCP server: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const server = createServer(new LedgerlineApi(config));
await server.connect(new StdioServerTransport());
console.error(`Ledgerline MCP server running on stdio, using the API at ${config.apiUrl}`);

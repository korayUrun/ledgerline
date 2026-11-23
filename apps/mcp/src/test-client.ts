import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { LedgerlineApi, type Fetch } from "./api-client.js";

// Test helpers. Not imported by the server itself.

export const TEST_CONFIG = { apiUrl: "http://api.test", apiKey: `ll_3f9a1c2e_${"a".repeat(43)}` };

// For tests: a real MCP server and a real MCP client, connected in memory instead of
// over stdio. Every test call goes through the actual protocol (initialize,
// tools/list, tools/call), so the tests see what Claude Desktop would see.
export async function connectTestClient(register: (server: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: "ledgerline-test", version: "0.0.0" });
  register(server);
  return connect(server);
}

export async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export type SentRequest = { method: string; url: string; body: unknown };

// A LedgerlineApi whose "API" always gives `answer`, and the requests it was sent.
export function fakeApi(answer: () => Response): { api: LedgerlineApi; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fetchFn: Fetch = (input, init) => {
    sent.push({
      method: init?.method ?? "GET",
      url: input instanceof Request ? input.url : String(input),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(answer());
  };
  return { api: new LedgerlineApi(TEST_CONFIG, fetchFn), sent };
}

// The text of a tool result's first content block. callTool's return type also
// allows an old protocol shape ({ toolResult }), so the result is parsed with the
// SDK's own schema for the current shape.
export function resultText(result: unknown): string {
  const first = CallToolResultSchema.parse(result).content[0];
  return first?.type === "text" ? first.text : "";
}

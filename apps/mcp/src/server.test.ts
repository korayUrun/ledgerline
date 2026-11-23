import { describe, expect, it } from "vitest";
import { createServer, SERVER_NAME } from "./server.js";
import { connect, fakeApi } from "./test-client.js";

// The whole server, as an MCP client sees it after the handshake.
async function connectedClient() {
  const { api } = fakeApi(() => Response.json({}));
  return connect(createServer(api));
}

describe("the Ledgerline MCP server", () => {
  it("introduces itself with instructions in the handshake", async () => {
    const client = await connectedClient();

    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    expect(client.getInstructions()).toMatch(/cannot approve or pay/);
  });

  it("offers exactly the four tools, each with a description", async () => {
    const client = await connectedClient();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "explain_settlement_line",
      "flag_expense",
      "get_settlement",
      "list_shows",
    ]);
    for (const tool of tools) {
      expect(tool.description?.length, tool.name).toBeGreaterThan(50);
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it("has no tool that could approve, pay or retry a payment", async () => {
    const client = await connectedClient();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).join(" ")).not.toMatch(/approve|pay|retry|transfer/i);
  });
});

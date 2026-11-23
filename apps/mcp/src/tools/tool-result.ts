import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiRequestError } from "../api-client.js";

// How every tool answers. Two forms of the same data:
//   - structuredContent: the JSON object, checked by the SDK against the tool's
//     outputSchema, for clients that read typed results;
//   - content: the same JSON as text, which is what most clients (Claude Desktop
//     included) put in front of the model. The MCP spec asks for both.
export function toolResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

// Runs one API call for a tool. An ApiRequestError (key revoked, rate limit, 404…)
// is an answer the model should read and act on, so it becomes a tool result with
// isError: true. Anything else is a bug in this server and is thrown as it is.
export async function runTool(
  call: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    return toolResult(await call());
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    throw error;
  }
}

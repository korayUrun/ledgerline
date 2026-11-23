import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it, vi } from "vitest";
import { buildAuditTools } from "./index.js";
import { auditContextFixture } from "./test-fixture.js";

describe("buildAuditTools", () => {
  const tools = buildAuditTools(auditContextFixture(), vi.fn());

  it("has exactly the audit tools, and nothing that can approve, pay or edit", () => {
    // An exact list on purpose: adding a tool means changing this test, in review.
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_settlement",
      "get_contract_terms",
      "list_expenses",
      "list_ticket_sales",
      "explain_line",
      "recompute_settlement",
      "flag_expense",
    ]);
  });

  it("gives every tool an object input schema the API accepts", () => {
    for (const tool of tools) {
      // The same conversion runAgent does; it throws on a schema it cannot express.
      expect(zodOutputFormat(tool.inputSchema).schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
  });
});

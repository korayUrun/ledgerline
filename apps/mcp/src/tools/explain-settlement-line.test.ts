import { describe, expect, it } from "vitest";
import { connectTestClient, fakeApi, resultText } from "../test-client.js";
import { registerExplainSettlementLine } from "./explain-settlement-line.js";
import { EXPLANATION, SETTLEMENT_ID } from "./fixtures.js";

async function clientWith(answer: () => Response) {
  const { api, sent } = fakeApi(answer);
  const client = await connectTestClient((server) => registerExplainSettlementLine(server, api));
  return { client, sent };
}

describe("explain_settlement_line", () => {
  it("calls GET /v1/settlements/:id/lines/:position and returns the explanation", async () => {
    const { client, sent } = await clientWith(() => Response.json(EXPLANATION));

    const result = await client.callTool({
      name: "explain_settlement_line",
      arguments: { settlementId: SETTLEMENT_ID, position: 0 },
    });

    expect(sent).toEqual([
      {
        method: "GET",
        url: `http://api.test/v1/settlements/${SETTLEMENT_ID}/lines/0`,
        body: undefined,
      },
    ]);
    expect(result.structuredContent).toEqual(EXPLANATION);
  });

  it("refuses a negative or fractional position before calling the API", async () => {
    const { client, sent } = await clientWith(() => Response.json(EXPLANATION));

    for (const position of [-1, 1.5]) {
      const result = await client.callTool({
        name: "explain_settlement_line",
        arguments: { settlementId: SETTLEMENT_ID, position },
      });
      expect(result.isError).toBe(true);
    }
    expect(sent).toEqual([]);
  });

  it("passes on the valid range when the position is past the last line", async () => {
    const { client } = await clientWith(() =>
      Response.json(
        { statusCode: 404, message: "There is no line at position 99. Positions go from 0 to 17." },
        { status: 404 },
      ),
    );

    const result = await client.callTool({
      name: "explain_settlement_line",
      arguments: { settlementId: SETTLEMENT_ID, position: 99 },
    });

    expect(resultText(result)).toMatch(/Positions go from 0 to 17/);
  });
});

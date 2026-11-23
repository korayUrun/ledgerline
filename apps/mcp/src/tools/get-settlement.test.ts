import { describe, expect, it } from "vitest";
import { connectTestClient, fakeApi, resultText } from "../test-client.js";
import { SETTLEMENT, SETTLEMENT_ID } from "./fixtures.js";
import { registerGetSettlement } from "./get-settlement.js";

async function clientWith(answer: () => Response) {
  const { api, sent } = fakeApi(answer);
  const client = await connectTestClient((server) => registerGetSettlement(server, api));
  return { client, sent };
}

describe("get_settlement", () => {
  it("calls GET /v1/settlements/:id and returns the settlement", async () => {
    const { client, sent } = await clientWith(() => Response.json(SETTLEMENT));

    const result = await client.callTool({
      name: "get_settlement",
      arguments: { settlementId: SETTLEMENT_ID },
    });

    expect(sent).toEqual([
      { method: "GET", url: `http://api.test/v1/settlements/${SETTLEMENT_ID}`, body: undefined },
    ]);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(SETTLEMENT);
  });

  it("refuses an id that is not a UUID before calling the API", async () => {
    const { client, sent } = await clientWith(() => Response.json(SETTLEMENT));

    const result = await client.callTool({
      name: "get_settlement",
      arguments: { settlementId: "../../api-keys" },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/Input validation error/);
    expect(sent).toEqual([]);
  });

  it("passes on the API's 404 message", async () => {
    const { client } = await clientWith(() =>
      Response.json(
        { statusCode: 404, message: `Settlement ${SETTLEMENT_ID} not found` },
        { status: 404 },
      ),
    );

    const result = await client.callTool({
      name: "get_settlement",
      arguments: { settlementId: SETTLEMENT_ID },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(
      `The Ledgerline API answered 404: Settlement ${SETTLEMENT_ID} not found`,
    );
  });
});

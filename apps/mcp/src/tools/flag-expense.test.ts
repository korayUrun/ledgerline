import { describe, expect, it } from "vitest";
import { connectTestClient, fakeApi, resultText } from "../test-client.js";
import { EXPENSE_ID, FLAG } from "./fixtures.js";
import { registerFlagExpense } from "./flag-expense.js";

async function clientWith(answer: () => Response) {
  const { api, sent } = fakeApi(answer);
  const client = await connectTestClient((server) => registerFlagExpense(server, api));
  return { client, sent };
}

const ARGUMENTS = {
  expenseId: EXPENSE_ID,
  kind: "category_not_allowed",
  reason: "  Office supplies are not an allowed category (§5).  ",
};

describe("flag_expense", () => {
  it("POSTs the flag to /v1/expenses/:id/flags with a trimmed reason", async () => {
    const { client, sent } = await clientWith(() => Response.json(FLAG, { status: 201 }));

    const result = await client.callTool({ name: "flag_expense", arguments: ARGUMENTS });

    expect(sent).toEqual([
      {
        method: "POST",
        url: `http://api.test/v1/expenses/${EXPENSE_ID}/flags`,
        body: {
          kind: "category_not_allowed",
          reason: "Office supplies are not an allowed category (§5).",
        },
      },
    ]);
    expect(result.structuredContent).toEqual(FLAG);
  });

  it("is a write, but not destructive and safe to repeat", async () => {
    const { client } = await clientWith(() => Response.json(FLAG));

    const { tools } = await client.listTools();

    expect(tools[0]?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("refuses a kind the API does not know before calling it", async () => {
    const { client, sent } = await clientWith(() => Response.json(FLAG));

    const result = await client.callTool({
      name: "flag_expense",
      arguments: { ...ARGUMENTS, kind: "approve_payout" },
    });

    expect(result.isError).toBe(true);
    expect(sent).toEqual([]);
  });

  it("passes on the API's refusal once the settlement is approved", async () => {
    const { client } = await clientWith(() =>
      Response.json(
        {
          statusCode: 409,
          message: "The settlement is approved: its expenses can no longer be flagged.",
        },
        { status: 409 },
      ),
    );

    const result = await client.callTool({ name: "flag_expense", arguments: ARGUMENTS });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/can no longer be flagged/);
  });
});

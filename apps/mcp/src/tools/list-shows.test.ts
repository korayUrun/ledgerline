import { describe, expect, it } from "vitest";
import { connectTestClient, fakeApi, resultText } from "../test-client.js";
import { registerListShows } from "./list-shows.js";

const SHOWS = {
  data: [
    {
      id: "3321fa10-5c2b-4a1c-8a9d-647bf36084d2",
      name: "Friday",
      showDate: "2026-11-06",
      venueName: "Friday Hall",
      artistName: "Friday Band",
      settlement: {
        id: "3eecc113-f334-4e9f-b4a7-0c1d2e3f4a5b",
        status: "in_review",
        payout: { cents: 1_202_040, formatted: "$12,020.40" },
      },
    },
  ],
};

// A client connected to a server that has only list_shows, over an API that always
// gives `answer`.
async function clientWith(answer: () => Response) {
  const { api, sent } = fakeApi(answer);
  const client = await connectTestClient((server) => registerListShows(server, api));
  return { client, sent };
}

describe("list_shows", () => {
  it("is listed as a read-only tool with no arguments", async () => {
    const { client } = await clientWith(() => Response.json(SHOWS));

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["list_shows"]);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.inputSchema.properties ?? {}).toEqual({});
  });

  it("calls GET /v1/shows and returns the shows as structured content and as text", async () => {
    const { client, sent } = await clientWith(() => Response.json(SHOWS));

    const result = await client.callTool({ name: "list_shows", arguments: {} });

    expect(sent).toEqual([{ method: "GET", url: "http://api.test/v1/shows", body: undefined }]);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(SHOWS);
    expect(resultText(result)).toBe(JSON.stringify(SHOWS, null, 2));
  });

  it("turns a revoked key into an error the model can read", async () => {
    const { client } = await clientWith(() =>
      Response.json({ statusCode: 401, message: "A valid API key is required" }, { status: 401 }),
    );

    const result = await client.callTool({ name: "list_shows", arguments: {} });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/revoked/);
  });
});

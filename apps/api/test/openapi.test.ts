import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "./test-app.js";

// The OpenAPI document of the public API (F9), as a client downloads it.

type Operation = {
  security?: Record<string, string[]>[];
  parameters?: { name: string; in: string; schema: { type: string } }[];
  requestBody?: { content: { "application/json": { schema: { required?: string[] } } } };
  responses: Record<string, { content?: { "application/json": { schema: Schema } } }>;
};
type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[] };
type Document = {
  openapi: string;
  info: { title: string };
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, { scheme: string; bearerFormat: string }> };
};

let t: TestApp;
let doc: Document;

beforeAll(async () => {
  t = await startTestApp();
  // No auth headers: like any API's docs, the document is public. It holds shapes,
  // never data.
  const response = await fetch(`${t.baseUrl}/v1/openapi.json`);
  expect(response.status).toBe(200);
  doc = (await response.json()) as Document;
});
afterAll(async () => {
  await t.close();
});

describe("the /v1 OpenAPI document", () => {
  it("lists exactly the four /v1 routes", () => {
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/v1/expenses/{expenseId}/flags",
      "/v1/settlements/{settlementId}",
      "/v1/settlements/{settlementId}/lines/{position}",
      "/v1/shows",
    ]);
  });

  it("offers nothing that approves, pays or manages keys", () => {
    const everything = JSON.stringify(Object.keys(doc.paths));

    expect(everything).not.toMatch(/approve|pay|retry|api-keys|stripe|auth/i);
  });

  it("puts every operation behind the API key", () => {
    expect(doc.components.securitySchemes["apiKey"]).toMatchObject({ scheme: "bearer" });
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(operation.security, `${method} ${path}`).toEqual([{ apiKey: [] }]);
        expect(Object.keys(operation.responses), `${method} ${path}`).toEqual(
          expect.arrayContaining(["401", "429"]),
        );
      }
    }
  });

  it("takes the response shapes from the Zod schemas", () => {
    const settlement = doc.paths["/v1/settlements/{settlementId}"]?.["get"];
    const schema = settlement?.responses["200"]?.content?.["application/json"].schema;

    expect(schema?.required).toEqual(
      expect.arrayContaining(["id", "status", "payout", "lines", "payments"]),
    );
    // Money is { cents, formatted } everywhere.
    expect(schema?.properties?.["lines"]).toMatchObject({
      type: "array",
      items: { properties: { amount: { required: ["cents", "formatted"] } } },
    });
  });

  it("describes the path parameters and the flag body", () => {
    const explain = doc.paths["/v1/settlements/{settlementId}/lines/{position}"]?.["get"];
    const flag = doc.paths["/v1/expenses/{expenseId}/flags"]?.["post"];

    expect(explain?.parameters?.find((p) => p.name === "position")?.schema.type).toBe("integer");
    expect(flag?.requestBody?.content["application/json"].schema.required).toEqual([
      "kind",
      "reason",
    ]);
    expect(Object.keys(flag?.responses ?? {})).toEqual(
      expect.arrayContaining(["200", "201", "400", "404", "409"]),
    );
  });

  it("serves a browsable page at /v1/docs", async () => {
    const page = await fetch(`${t.baseUrl}/v1/docs`);

    expect(page.status).toBe(200);
    expect(await page.text()).toContain("swagger");
  });
});

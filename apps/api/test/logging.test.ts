import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, startTestApp, type TestApp } from "./test-app.js";

// The request side of structured logging (docs/SYSTEM.md §12), through the real app:
// the middleware gives each request a requestId, the interceptor adds the route's
// settlementId, and the "request finished" line carries both.

let t: TestApp;
const lines: Record<string, unknown>[] = [];

beforeAll(async () => {
  t = await startTestApp({
    logDestination: {
      write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
    },
  });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  lines.length = 0;
});

// The line is written on the response's "finish" event, which can come a moment
// after fetch() has the response.
async function requestLine(requestId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const line = lines.find((l) => l["msg"] === "request finished" && l["requestId"] === requestId);
    if (line) return line;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`no "request finished" line for ${requestId}`);
}

describe("request logging", () => {
  it("keeps the caller's request id and logs it with the settlement id", async () => {
    const settlementId = randomUUID();
    const response = await t.fetch(`/settlements/${settlementId}/flags`, {
      headers: { "x-request-id": "test-request-1" },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe("test-request-1");
    expect(await requestLine("test-request-1")).toMatchObject({
      method: "GET",
      path: `/settlements/${settlementId}/flags`,
      statusCode: 404,
      settlementId,
    });
  });

  it("makes up an id when the caller sends none, or one that is not plain", async () => {
    const none = await t.fetch("/health");
    const odd = await t.fetch("/health", { headers: { "x-request-id": "has spaces/and slashes" } });

    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(none.headers.get("x-request-id")).toMatch(uuid);
    expect(odd.headers.get("x-request-id")).toMatch(uuid);
    expect(none.headers.get("x-request-id")).not.toBe(odd.headers.get("x-request-id"));
  });

  it("logs the path without the query string", async () => {
    await t.fetch("/shows?secret=abc", { headers: { "x-request-id": "test-request-2" } });
    expect(await requestLine("test-request-2")).toMatchObject({ path: "/shows" });
  });
});

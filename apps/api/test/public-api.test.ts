import type {
  ApiKeyDto,
  AuditEntryDto,
  CreatedApiKeyDto,
  SettlementViewDto,
  V1ShowList,
} from "@ledgerline/schemas";
import { V1ShowListSchema } from "@ledgerline/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashApiKey } from "../src/modules/public-api/api-key-secret.js";
import {
  createShowInReview,
  resetDatabase,
  startTestApp,
  TEST_SESSION_TOKEN,
  VERSUS_TERMS,
  type TestApp,
} from "./test-app.js";

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
});

const NO_AUTH = {};
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

// Created by the demo user through the session routes, like a person would.
async function createKey(name = "Claude Desktop"): Promise<CreatedApiKeyDto> {
  const response = await t.request<CreatedApiKeyDto>("POST", "/api-keys", { name });
  expect(response.status).toBe(201);
  return response.body;
}

describe("creating an API key", () => {
  it("returns the full key once and stores only its hash and prefix", async () => {
    const { apiKey, key } = await createKey();

    expect(key).toMatch(/^ll_[0-9a-f]{8}_/);
    expect(key.startsWith(`ll_${apiKey.prefix}_`)).toBe(true);
    const row = await t.prisma.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(row.keyHash).toBe(hashApiKey(key));
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it("never shows the key again: the list has the prefix only", async () => {
    const { key } = await createKey();

    const list = await t.request<ApiKeyDto[]>("GET", "/api-keys");

    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ name: "Claude Desktop", createdByName: "Demo Manager" });
    expect(JSON.stringify(list.body)).not.toContain(key);
    expect(JSON.stringify(list.body)).not.toContain(hashApiKey(key));
  });

  it("is audited without the key", async () => {
    const { apiKey, key } = await createKey();

    const audit = await t.request<AuditEntryDto[]>(
      "GET",
      `/audit?entity=api_key&entityId=${apiKey.id}`,
    );
    expect(audit.body.map((entry) => entry.action)).toEqual(["api_key.created"]);
    expect(JSON.stringify(audit.body)).not.toContain(key);
  });

  it("needs a logged-in person: an API key cannot create keys", async () => {
    const { key } = await createKey();

    const withKey = await t.request("POST", "/api-keys", { name: "more" }, bearer(key));
    const anonymous = await t.request("POST", "/api-keys", { name: "more" }, NO_AUTH);

    expect(withKey.status).toBe(401);
    expect(anonymous.status).toBe(401);
  });

  it("refuses an empty name", async () => {
    const response = await t.request("POST", "/api-keys", { name: "  " });

    expect(response.status).toBe(400);
  });
});

describe("/v1 with an API key", () => {
  it("lists shows with their settlement, newest first, in the published shape", async () => {
    const { showId } = await createShowInReview(t, "Friday", VERSUS_TERMS);
    const { key } = await createKey();

    const response = await t.request<V1ShowList>("GET", "/v1/shows", undefined, bearer(key));

    expect(response.status).toBe(200);
    expect(V1ShowListSchema.parse(response.body)).toEqual(response.body);
    expect(response.body.data).toHaveLength(1);
    const show = response.body.data[0];
    expect(show).toMatchObject({
      id: showId,
      name: "Friday",
      showDate: "2026-11-06",
      venueName: "Friday Hall",
      artistName: "Friday Band",
      settlement: { status: "in_review" },
    });
    // Both forms of the same amount: integer cents and the text to quote.
    const payout = show?.settlement?.payout;
    expect(payout?.formatted).toMatch(/^\$[\d,]+\.\d{2}$/);
    expect(Number.isInteger(payout?.cents)).toBe(true);
  });

  it("records when the key was last used", async () => {
    const { apiKey, key } = await createKey();
    expect(apiKey.lastUsedAt).toBeNull();

    await t.request("GET", "/v1/shows", undefined, bearer(key));

    const row = await t.prisma.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("refuses no key, an unknown key and a session token", async () => {
    const none = await t.request("GET", "/v1/shows", undefined, NO_AUTH);
    const unknown = await t.request(
      "GET",
      "/v1/shows",
      undefined,
      bearer(`ll_00000000_${"a".repeat(43)}`),
    );
    // A person's session is not an API key: /v1 accepts keys only.
    const session = await t.request("GET", "/v1/shows", undefined, bearer(TEST_SESSION_TOKEN));

    expect(none.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(session.status).toBe(401);
  });
});

describe("what an API key can never do", () => {
  it("cannot use the session routes", async () => {
    const { key } = await createKey();

    const response = await t.request("GET", "/shows", undefined, bearer(key));

    expect(response.status).toBe(401);
  });

  it("cannot approve a settlement: the money stays where it is", async () => {
    const { showId } = await createShowInReview(t, "Friday", VERSUS_TERMS);
    const { key } = await createKey();

    const approve = await t.request(
      "POST",
      `/shows/${showId}/settlement/approve`,
      undefined,
      bearer(key),
    );
    const retry = await t.request(
      "POST",
      `/shows/${showId}/settlement/retry-payment`,
      undefined,
      bearer(key),
    );

    expect(approve.status).toBe(401);
    expect(retry.status).toBe(401);
    const view = await t.request<SettlementViewDto>("GET", `/shows/${showId}/settlement`);
    expect(view.body.settlement?.status).toBe("in_review");
    expect(view.body.payouts).toEqual([]);
    expect(await t.prisma.payout.count()).toBe(0);
  });
});

describe("revoking an API key", () => {
  it("stops the key on its very next request", async () => {
    const { apiKey, key } = await createKey();
    expect((await t.request("GET", "/v1/shows", undefined, bearer(key))).status).toBe(200);

    const revoked = await t.request<ApiKeyDto>("POST", `/api-keys/${apiKey.id}/revoke`);

    expect(revoked.status).toBe(200);
    expect(revoked.body.revokedAt).not.toBeNull();
    expect((await t.request("GET", "/v1/shows", undefined, bearer(key))).status).toBe(401);
  });

  it("keeps the row and audits who revoked it", async () => {
    const { apiKey } = await createKey();

    await t.request("POST", `/api-keys/${apiKey.id}/revoke`);

    const audit = await t.request<AuditEntryDto[]>(
      "GET",
      `/audit?entity=api_key&entityId=${apiKey.id}`,
    );
    expect(audit.body.map((entry) => entry.action)).toEqual(["api_key.created", "api_key.revoked"]);
    expect(audit.body[1]?.actor).toMatch(/^user:/);
    expect(await t.prisma.apiKey.count()).toBe(1);
  });

  it("answers 409 for a key that is already revoked and 404 for an unknown one", async () => {
    const { apiKey } = await createKey();
    await t.request("POST", `/api-keys/${apiKey.id}/revoke`);

    const again = await t.request("POST", `/api-keys/${apiKey.id}/revoke`);
    const unknown = await t.request(
      "POST",
      "/api-keys/00000000-0000-4000-8000-000000000000/revoke",
    );

    expect(again.status).toBe(409);
    expect(unknown.status).toBe(404);
  });
});

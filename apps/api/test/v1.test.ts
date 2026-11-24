import type {
  AuditEntryDto,
  CreatedApiKeyDto,
  ExpenseFlagDto,
  V1ExpenseFlag,
  V1LineExplanation,
  V1Settlement,
  V1ShowList,
} from "@ledgerline/schemas";
import {
  V1ExpenseFlagSchema,
  V1LineExplanationSchema,
  V1SettlementSchema,
} from "@ledgerline/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createShowInReview,
  resetDatabase,
  startTestApp,
  VERSUS_TERMS,
  type TestApp,
} from "./test-app.js";

let t: TestApp;
let key: string;
let apiKeyId: string;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  const created = await t.request<CreatedApiKeyDto>("POST", "/api-keys", { name: "MCP" });
  key = created.body.key;
  apiKeyId = created.body.apiKey.id;
});

// A /v1 request with the API key, the way the MCP server makes it.
function v1<T>(method: string, path: string, body?: unknown) {
  return t.request<T>(method, `/v1${path}`, body, { authorization: `Bearer ${key}` });
}

// The show in review from test-app.ts, plus its settlement id as /v1 sees it.
async function showInReview() {
  const show = await createShowInReview(t, "Friday", VERSUS_TERMS);
  const list = await v1<V1ShowList>("GET", "/shows");
  const settlementId = list.body.data[0]?.settlement?.id;
  if (!settlementId) throw new Error("the show has no settlement");
  return { ...show, settlementId };
}

describe("GET /v1/settlements/:id", () => {
  it("returns the worksheet lines, the payout and the show, in the published shape", async () => {
    const { showId, settlementId } = await showInReview();

    const response = await v1<V1Settlement>("GET", `/settlements/${settlementId}`);

    expect(response.status).toBe(200);
    expect(V1SettlementSchema.parse(response.body)).toEqual(response.body);
    const settlement = response.body;
    expect(settlement).toMatchObject({
      id: settlementId,
      status: "in_review",
      version: 1,
      termsVersion: 1,
      show: { id: showId, name: "Friday", artistName: "Friday Band" },
      payments: [],
      openFlagCount: 0,
    });
    // The payout is the last line, and the two always agree.
    const last = settlement.lines.at(-1);
    expect(last?.kind).toBe("total_payout");
    expect(last?.amount).toEqual(settlement.payout);
    expect(settlement.lines.map((line) => line.position)).toEqual(
      settlement.lines.map((_, index) => index),
    );
  });

  it("says stale when the inputs changed behind the API's back", async () => {
    const { expenses, settlementId } = await showInReview();
    await t.prisma.expense.update({
      where: { id: expenses[0]?.id ?? "" },
      data: { amountCents: 1 },
    });

    const response = await v1<V1Settlement>("GET", `/settlements/${settlementId}`);

    expect(response.body.status).toBe("stale");
  });

  it("answers 404 for an unknown settlement and 400 for a malformed id", async () => {
    const unknown = await v1("GET", "/settlements/00000000-0000-4000-8000-000000000000");
    const malformed = await v1("GET", "/settlements/not-a-uuid");

    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});

describe("GET /v1/settlements/:id/lines/:position", () => {
  it("explains a box office line with its ticket tiers", async () => {
    const { settlementId } = await showInReview();
    const settlement = await v1<V1Settlement>("GET", `/settlements/${settlementId}`);
    const gbor = settlement.body.lines.find((line) => line.kind === "gbor");

    const response = await v1<V1LineExplanation>(
      "GET",
      `/settlements/${settlementId}/lines/${gbor?.position}`,
    );

    expect(response.status).toBe(200);
    expect(V1LineExplanationSchema.parse(response.body)).toEqual(response.body);
    expect(response.body.line).toEqual(gbor);
    expect(response.body.ticketSales.map((sale) => sale.tierName)).toEqual(["GA", "VIP"]);
    expect(response.body.clauses).toEqual([]);
  });

  it("explains the payout line with the deal clause of the confirmed terms", async () => {
    const { settlementId } = await showInReview();
    const settlement = await v1<V1Settlement>("GET", `/settlements/${settlementId}`);
    const dealPayout = settlement.body.lines.find((line) => line.kind === "deal_payout");

    const response = await v1<V1LineExplanation>(
      "GET",
      `/settlements/${settlementId}/lines/${dealPayout?.position}`,
    );

    expect(response.body.clauses).toEqual([
      {
        ref: "§4.2",
        section: "deal",
        terms: [
          { name: "deal type", value: "versus" },
          { name: "guarantee", value: "$5,000.00" },
          { name: "artist share", value: "85%" },
        ],
        quotes: [], // typed in by hand, not read from a PDF
      },
    ]);
  });

  it("explains an expense line with the expenses and their descriptions", async () => {
    const { settlementId } = await showInReview();
    const settlement = await v1<V1Settlement>("GET", `/settlements/${settlementId}`);
    const submitted = settlement.body.lines.find((line) => line.kind === "expenses_submitted");

    const response = await v1<V1LineExplanation>(
      "GET",
      `/settlements/${settlementId}/lines/${submitted?.position}`,
    );

    expect(response.body.expenses.map((expense) => expense.description)).toEqual([
      "Crew",
      "Security",
    ]);
  });

  it("answers 404 with the valid range for a position past the last line", async () => {
    const { settlementId } = await showInReview();

    const response = await v1<{ message: string }>("GET", `/settlements/${settlementId}/lines/999`);

    expect(response.status).toBe(404);
    expect(response.body.message).toMatch(/Positions go from 0 to \d+/);
  });
});

describe("POST /v1/expenses/:id/flags", () => {
  const body = { kind: "other", reason: "The receipt looks like a duplicate of last week's." };

  it("opens a flag a person then sees on the worksheet, audited as the API key", async () => {
    const { expenses, settlementId } = await showInReview();
    const expenseId = expenses[0]?.id ?? "";

    const response = await v1<V1ExpenseFlag>("POST", `/expenses/${expenseId}/flags`, body);

    expect(response.status).toBe(201);
    expect(V1ExpenseFlagSchema.parse(response.body)).toEqual(response.body);
    expect(response.body).toMatchObject({
      expenseId,
      kind: "other",
      status: "open",
      created: true,
    });

    const flags = await t.request<ExpenseFlagDto[]>("GET", `/settlements/${settlementId}/flags`);
    expect(flags.body).toHaveLength(1);
    expect(flags.body[0]).toMatchObject({ apiKeyId, agentRunId: null });
    const audit = await t.request<AuditEntryDto[]>(
      "GET",
      `/audit?entity=expense&entityId=${expenseId}`,
    );
    expect(audit.body.at(-1)).toMatchObject({
      action: "expense.flagged",
      actor: `api_key:${apiKeyId}`,
    });
    const settlement = await v1<V1Settlement>("GET", `/settlements/${settlementId}`);
    expect(settlement.body.openFlagCount).toBe(1);
  });

  it("returns the existing open flag instead of a duplicate (200)", async () => {
    const { expenses } = await showInReview();
    const expenseId = expenses[0]?.id ?? "";

    const first = await v1<V1ExpenseFlag>("POST", `/expenses/${expenseId}/flags`, body);
    const second = await v1<V1ExpenseFlag>("POST", `/expenses/${expenseId}/flags`, body);

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, created: false });
    expect(await t.prisma.expenseFlag.count()).toBe(1);
  });

  it("changes neither the expense nor the settlement", async () => {
    const { expenses, settlementId } = await showInReview();
    const expenseId = expenses[0]?.id ?? "";
    const before = await t.prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });

    await v1("POST", `/expenses/${expenseId}/flags`, body);

    expect(await t.prisma.expense.findUniqueOrThrow({ where: { id: expenseId } })).toEqual(before);
    const settlement = await v1<V1Settlement>("GET", `/settlements/${settlementId}`);
    expect(settlement.body).toMatchObject({ status: "in_review", version: 1 });
  });

  it("blocks approval until a person resolves a flag opened during review", async () => {
    // Review started with no open flags; the MCP client flags an expense afterwards.
    const { showId, expenses } = await showInReview();
    const flagged = await v1<V1ExpenseFlag>("POST", `/expenses/${expenses[0]?.id}/flags`, body);
    expect(flagged.status).toBe(201);

    const blocked = await t.request<{ message: string }>(
      "POST",
      `/shows/${showId}/settlement/approve`,
    );

    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/1 assistant flag\(s\) are still open/);
    expect(await t.prisma.payout.count()).toBe(0);

    // Once the person dismisses it, the same settlement can be approved: a flag is
    // not an input, so nothing needs recomputing.
    const dismissed = await t.request("POST", `/flags/${flagged.body.id}/resolve`, {
      resolution: "dismissed",
    });
    expect(dismissed.status).toBe(200);
    const approved = await t.request("POST", `/shows/${showId}/settlement/approve`);
    expect(approved.status).toBe(200);
  });

  it("refuses once the settlement is approved: the numbers are final", async () => {
    const { showId, expenses } = await showInReview();
    const approved = await t.request("POST", `/shows/${showId}/settlement/approve`);
    expect(approved.status).toBe(200);

    const response = await v1("POST", `/expenses/${expenses[0]?.id}/flags`, body);

    expect(response.status).toBe(409);
    expect(await t.prisma.expenseFlag.count()).toBe(0);
  });

  it("answers 404 for an unknown expense and 400 for a bad body", async () => {
    const { expenses } = await showInReview();

    const unknown = await v1("POST", "/expenses/00000000-0000-4000-8000-000000000000/flags", body);
    const badKind = await v1("POST", `/expenses/${expenses[0]?.id}/flags`, {
      kind: "approve_it",
      reason: "x",
    });
    const noReason = await v1("POST", `/expenses/${expenses[0]?.id}/flags`, {
      kind: "other",
      reason: " ",
    });

    expect(unknown.status).toBe(404);
    expect(badKind.status).toBe(400);
    expect(noReason.status).toBe(400);
  });

  it("the database refuses a flag with no source, or with two", async () => {
    const { expenses } = await showInReview();
    const base = { expenseId: expenses[0]?.id ?? "", kind: "other" as const, reason: "x" };
    const run = await t.prisma.agentRun.create({
      data: {
        settlementId: (await t.prisma.settlement.findFirstOrThrow()).id,
        settlementVersion: 1,
        kind: "audit",
        question: "",
        model: "test",
        promptVersion: "test",
        startedBy: "user:test",
      },
    });

    await expect(t.prisma.expenseFlag.create({ data: base })).rejects.toThrow(/one_source/);
    await expect(
      t.prisma.expenseFlag.create({ data: { ...base, apiKeyId, agentRunId: run.id } }),
    ).rejects.toThrow(/one_source/);
  });
});

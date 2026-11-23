import type { AuditEntryDto, ExpenseDto, SettlementViewDto } from "@ledgerline/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createShowInReview,
  resetDatabase,
  startTestApp,
  VERSUS_TERMS,
  type TestApp,
} from "./test-app.js";

let t: TestApp;
let showId: string;
let expenses: ExpenseDto[];

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

// Every test starts from a settlement in review: computed, no pending expenses.
beforeEach(async () => {
  await resetDatabase(t.prisma);
  ({ showId, expenses } = await createShowInReview(t, "Test Night", VERSUS_TERMS));
});

const approve = (id = showId) =>
  t.request<SettlementViewDto & { message: string }>("POST", `/shows/${id}/settlement/approve`);
const retry = () =>
  t.request<SettlementViewDto & { message: string }>(
    "POST",
    `/shows/${showId}/settlement/retry-payment`,
  );

describe("approve", () => {
  it("moves the settlement to paying and writes the payout in the same transaction", async () => {
    const response = await approve();

    expect(response.status).toBe(200);
    const { settlement, payouts } = response.body;
    expect(settlement!.status).toBe("paying");
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({
      attempt: 1,
      status: "pending",
      amountCents: settlement!.payoutCents,
      idempotencyKey: `payout:${settlement!.id}:v${settlement!.version}:a1`,
      stripeTransferId: null,
    });

    // Two audit rows from the one transaction: who approved, and that paying began.
    const history = await t.request<AuditEntryDto[]>(
      "GET",
      `/audit?entity=settlement&entityId=${settlement!.id}`,
    );
    const actions = history.body.map((entry) => entry.action);
    expect(actions).toContain("settlement.approved");
    expect(actions).toContain("settlement.payment_started");
    const user = await t.prisma.user.findFirstOrThrow();
    expect(history.body.find((e) => e.action === "settlement.approved")!.actor).toBe(
      `user:${user.id}`,
    );
  });

  it("Break it (3): two approvals clicked at once create exactly one payout", async () => {
    const results = await Promise.all([approve(), approve()]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await t.prisma.payout.count()).toBe(1);
    const settlement = await t.prisma.settlement.findFirstOrThrow();
    expect(settlement.status).toBe("paying");
  });

  it("refuses a settlement that is not in review", async () => {
    await approve();

    const again = await approve();

    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/Only a settlement in review can be approved/);
    expect(await t.prisma.payout.count()).toBe(1);
  });

  it("refuses when the inputs changed behind the API's back, and writes nothing", async () => {
    await t.prisma.expense.update({
      where: { id: expenses[0]!.id },
      data: { amountCents: 300_000 },
    });

    const response = await approve();

    expect(response.status).toBe(409);
    expect(await t.prisma.payout.count()).toBe(0);
    // The read before approving noticed the drift and marked it stale.
    const settlement = await t.prisma.settlement.findFirstOrThrow();
    expect(settlement.status).toBe("stale");
  });

  it("refuses while the artist has no Stripe account to pay into", async () => {
    await t.prisma.artist.updateMany({ data: { stripeAccountId: null } });

    const response = await approve();

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/no Stripe account/);
    expect(await t.prisma.payout.count()).toBe(0);
    const settlement = await t.prisma.settlement.findFirstOrThrow();
    expect(settlement.status).toBe("in_review");
  });

  it("marks a $0 settlement paid without a payout: there is nothing to transfer", async () => {
    await resetDatabase(t.prisma);
    const zero = await createShowInReview(t, "Zero Night", {
      ...VERSUS_TERMS,
      // 0% versus a $0 guarantee: the artist is owed nothing.
      deal: { type: "versus", guaranteeCents: 0, artistShareBps: 0, clauseRef: "§4.2" },
    });

    const response = await approve(zero.showId);

    expect(response.status).toBe(200);
    expect(response.body.settlement).toMatchObject({ status: "paid", payoutCents: 0 });
    expect(response.body.payouts).toEqual([]);
  });
});

describe("locked inputs after approval", () => {
  it("refuses expense edits and recomputes instead of making the settlement stale", async () => {
    await approve();

    const edit = await t.request("PATCH", `/expenses/${expenses[0]!.id}`, { amountCents: 1 });
    const added = await t.request("POST", `/shows/${showId}/expenses`, {
      category: "production",
      description: "Late invoice",
      amountCents: 5_000,
      status: "allowed",
    });
    const recompute = await t.request("POST", `/shows/${showId}/settlement/compute`);

    expect([edit.status, added.status, recompute.status]).toEqual([409, 409, 409]);
    const expense = await t.prisma.expense.findUniqueOrThrow({ where: { id: expenses[0]!.id } });
    expect(expense.amountCents).toBe(280_000); // the refused edit rolled back
    expect(await t.prisma.expense.count()).toBe(2);
    const settlement = await t.prisma.settlement.findFirstOrThrow();
    expect(settlement.status).toBe("paying");
  });
});

describe("retry-payment", () => {
  // Until the payout job and webhook exist (next PRs), a failure is set by hand.
  async function failFirstPayout(): Promise<void> {
    await approve();
    await t.prisma.payout.updateMany({ data: { status: "failed", failureReason: "test" } });
    await t.prisma.settlement.updateMany({ data: { status: "payment_failed" } });
  }

  it("starts a new attempt with its own idempotency key", async () => {
    await failFirstPayout();

    const response = await retry();

    expect(response.status).toBe(200);
    const { settlement, payouts } = response.body;
    expect(settlement!.status).toBe("paying");
    expect(payouts.map((payout) => [payout.attempt, payout.status])).toEqual([
      [2, "pending"],
      [1, "failed"],
    ]);
    expect(payouts[0]!.idempotencyKey).toBe(`payout:${settlement!.id}:v${settlement!.version}:a2`);
  });

  it("two retries at once start exactly one new attempt", async () => {
    await failFirstPayout();

    const results = await Promise.all([retry(), retry()]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await t.prisma.payout.count()).toBe(2);
  });

  it("refuses while the payment has not failed", async () => {
    await approve();

    const response = await retry();

    expect(response.status).toBe(409);
    expect(await t.prisma.payout.count()).toBe(1);
  });
});

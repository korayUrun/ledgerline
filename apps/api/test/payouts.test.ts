import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AuditEntryDto, SettlementViewDto, StripeOnboardingDto } from "@ledgerline/schemas";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PayoutProcessor } from "../src/modules/payments/payout-processor.js";
import { PayoutSweeper, STUCK_AFTER_MS } from "../src/modules/payments/payout-sweeper.js";
import { WorkerModule } from "../src/worker.module.js";
import {
  createShowInReview,
  resetDatabase,
  startTestApp,
  TEST_WEBHOOK_SECRET,
  VERSUS_TERMS,
  type TestApp,
} from "./test-app.js";

// The payout job, the Stripe webhook and the sweeper, end to end with a fake Stripe
// (Phase 5). The four "Break it" drills each end with exactly one transfer and a
// paid settlement. The worker's processors are called directly, so each test
// decides when "the job runs".

let t: TestApp;
let worker: INestApplicationContext;
let processor: PayoutProcessor;
let sweeper: PayoutSweeper;
let showId: string;

beforeAll(async () => {
  t = await startTestApp();
  worker = await NestFactory.createApplicationContext(
    WorkerModule.register(t.config, { paymentGateway: t.payments, startQueueConsumer: false }),
    { logger: ["error"] },
  );
  processor = worker.get(PayoutProcessor);
  sweeper = worker.get(PayoutSweeper);
});
afterAll(async () => {
  await worker.close();
  await t.close();
});

beforeEach(async () => {
  await resetDatabase(t.prisma);
  t.payments.reset();
  ({ showId } = await createShowInReview(t, "Test Night", VERSUS_TERMS));
});

// Approves through the API and returns the payout it created.
async function approve() {
  const response = await t.request<SettlementViewDto>(
    "POST",
    `/shows/${showId}/settlement/approve`,
  );
  expect(response.status).toBe(200);
  return response.body.payouts[0]!;
}

const payoutRow = (id: string) => t.prisma.payout.findUniqueOrThrow({ where: { id } });
const settlementStatus = async () => (await t.prisma.settlement.findFirstOrThrow()).status;

// What Stripe sends when a transfer is made: the event, signed with the webhook
// secret exactly the way Stripe signs it.
function transferCreated(
  eventId: string,
  transfer: { id: string; amount: number; payoutId: string },
) {
  return {
    id: eventId,
    object: "event",
    type: "transfer.created",
    data: {
      object: {
        id: transfer.id,
        object: "transfer",
        amount: transfer.amount,
        currency: "usd",
        metadata: { payoutId: transfer.payoutId },
      },
    },
  };
}

async function sendWebhook(
  event: object,
  options: { secret?: string; body?: string } = {},
): Promise<{ status: number; body: { outcome?: string; message?: string } }> {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: options.secret ?? TEST_WEBHOOK_SECRET,
  });
  const response = await t.fetch("/payments/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    // A different body than the one signed = a tampered request.
    body: options.body ?? payload,
  });
  return { status: response.status, body: (await response.json()) as { outcome?: string } };
}

// The job ran and Stripe confirmed: the usual path.
async function confirm(payoutId: string, eventId = "evt_1") {
  const payout = await payoutRow(payoutId);
  return sendWebhook(
    transferCreated(eventId, {
      id: payout.stripeTransferId!,
      amount: Number(payout.amountCents),
      payoutId,
    }),
  );
}

describe("the payout job", () => {
  it("sends one transfer with the payout's key, then the webhook marks it paid", async () => {
    const payout = await approve();

    expect(await processor.process(payout.id)).toBe("transfer_created");

    const sent = [...t.payments.transfers.values()];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      idempotencyKey: payout.idempotencyKey,
      amountCents: payout.amountCents,
      payoutId: payout.id,
    });
    // Stripe accepted it, but only the webhook says "done".
    expect(await payoutRow(payout.id)).toMatchObject({ status: "processing" });
    expect(await settlementStatus()).toBe("paying");

    const webhook = await confirm(payout.id);

    expect(webhook).toMatchObject({ status: 200, body: { outcome: "paid" } });
    expect(await payoutRow(payout.id)).toMatchObject({ status: "succeeded" });
    expect(await settlementStatus()).toBe("paid");
  });

  it("does nothing when run again after the transfer exists", async () => {
    const payout = await approve();
    await processor.process(payout.id);

    expect(await processor.process(payout.id)).toBe("skipped");
    expect(t.payments.calls).toBe(1);
  });

  it("marks the payout failed when Stripe refuses, and a retry pays with a new key", async () => {
    const payout = await approve();
    t.payments.refuseNext();

    expect(await processor.process(payout.id)).toBe("failed");
    expect(await payoutRow(payout.id)).toMatchObject({
      status: "failed",
      failureReason: "Stripe: insufficient funds (fake)",
    });
    expect(await settlementStatus()).toBe("payment_failed");

    const retried = await t.request<SettlementViewDto>(
      "POST",
      `/shows/${showId}/settlement/retry-payment`,
    );
    const second = retried.body.payouts[0]!;
    await processor.process(second.id);
    await confirm(second.id);

    expect(second.idempotencyKey).not.toBe(payout.idempotencyKey);
    expect(t.payments.transfers.size).toBe(1); // the refused call made none
    expect(await settlementStatus()).toBe("paid");
  });

  it("leaves the payout processing on a timeout: the outcome is unknown, so never 'failed'", async () => {
    const payout = await approve();
    t.payments.timeOutNext();

    await expect(processor.process(payout.id)).rejects.toThrow("timed out");

    expect(await payoutRow(payout.id)).toMatchObject({
      status: "processing",
      stripeTransferId: null,
    });
    expect(await settlementStatus()).toBe("paying");
  });
});

describe("Break it (all four end with one transfer and a paid settlement)", () => {
  it("1: the worker dies right after the Stripe call; the retry gets the same transfer back", async () => {
    const payout = await approve();
    t.payments.crashAfterNextTransfer();

    await expect(processor.process(payout.id)).rejects.toThrow("worker killed");
    // The money moved, but the database does not know the transfer id yet.
    expect(await payoutRow(payout.id)).toMatchObject({
      status: "processing",
      stripeTransferId: null,
    });

    // BullMQ retries the job: same payout, same idempotency key.
    expect(await processor.process(payout.id)).toBe("transfer_created");
    await confirm(payout.id);

    expect(t.payments.calls).toBe(2);
    expect(t.payments.transfers.size).toBe(1);
    expect(await settlementStatus()).toBe("paid");
  });

  it("2: the same webhook delivered twice changes things once", async () => {
    const payout = await approve();
    await processor.process(payout.id);

    const first = await confirm(payout.id, "evt_same");
    const second = await confirm(payout.id, "evt_same");

    expect(first.body.outcome).toBe("paid");
    expect(second).toMatchObject({ status: 200, body: { outcome: "duplicate" } });
    const settlement = await t.prisma.settlement.findFirstOrThrow();
    const history = await t.request<AuditEntryDto[]>(
      "GET",
      `/audit?entity=settlement&entityId=${settlement.id}`,
    );
    expect(history.body.filter((entry) => entry.action === "settlement.paid")).toHaveLength(1);
    expect(t.payments.transfers.size).toBe(1);
    expect(settlement.status).toBe("paid");
  });

  it("3: approve clicked twice: one payout, one transfer", async () => {
    const [first, second] = await Promise.all([
      t.request("POST", `/shows/${showId}/settlement/approve`),
      t.request("POST", `/shows/${showId}/settlement/approve`),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const payouts = await t.prisma.payout.findMany();
    expect(payouts).toHaveLength(1);

    await processor.process(payouts[0]!.id);
    await processor.process(payouts[0]!.id); // a duplicate job changes nothing
    await confirm(payouts[0]!.id);

    expect(t.payments.transfers.size).toBe(1);
    expect(await settlementStatus()).toBe("paid");
  });

  it("4: a webhook with a bad signature is refused and changes nothing", async () => {
    const payout = await approve();
    await processor.process(payout.id);
    const row = await payoutRow(payout.id);
    const event = transferCreated("evt_forged", {
      id: row.stripeTransferId!,
      amount: Number(row.amountCents),
      payoutId: payout.id,
    });

    const wrongSecret = await sendWebhook(event, { secret: "whsec_someone_else" });
    const tampered = await sendWebhook(event, {
      body: JSON.stringify({ ...event, id: "evt_tampered" }),
    });

    expect(wrongSecret.status).toBe(400);
    expect(tampered.status).toBe(400);
    expect(await t.prisma.processedWebhookEvent.count()).toBe(0);
    expect(await settlementStatus()).toBe("paying");

    // The real webhook still works afterwards.
    await confirm(payout.id);
    expect(t.payments.transfers.size).toBe(1);
    expect(await settlementStatus()).toBe("paid");
  });
});

describe("the webhook", () => {
  it("can arrive before the job saved the transfer id; the job then has nothing to do", async () => {
    const payout = await approve();
    t.payments.crashAfterNextTransfer();
    await expect(processor.process(payout.id)).rejects.toThrow();
    const [transfer] = [...t.payments.transfers.values()];

    const webhook = await sendWebhook(
      transferCreated("evt_early", {
        id: transfer!.transferId,
        amount: transfer!.amountCents,
        payoutId: payout.id,
      }),
    );

    expect(webhook.body.outcome).toBe("paid");
    expect(await processor.process(payout.id)).toBe("skipped");
    expect(t.payments.transfers.size).toBe(1);
  });

  it("never marks paid a transfer of a different amount than the approved one", async () => {
    const payout = await approve();
    await processor.process(payout.id);
    const row = await payoutRow(payout.id);

    const webhook = await sendWebhook(
      transferCreated("evt_wrong", {
        id: row.stripeTransferId!,
        amount: Number(row.amountCents) + 1,
        payoutId: payout.id,
      }),
    );

    expect(webhook.body.outcome).toBe("ignored");
    expect(await settlementStatus()).toBe("paying");
  });

  it("acknowledges events that are not about our payouts", async () => {
    const webhook = await sendWebhook(
      transferCreated("evt_other", { id: "tr_other", amount: 100, payoutId: "not-ours" }),
    );

    expect(webhook).toMatchObject({ status: 200, body: { outcome: "ignored" } });
  });
});

describe("the sweeper", () => {
  it("re-enqueues payouts stuck before the transfer, and leaves the rest alone", async () => {
    const payout = await approve();
    const later = new Date(Date.now() + STUCK_AFTER_MS + 60_000);

    expect(await sweeper.sweep(new Date())).toEqual([]); // not stuck yet
    expect(await sweeper.sweep(later)).toEqual([payout.id]);

    // Once the transfer exists, it is waiting for the webhook, not stuck.
    await processor.process(payout.id);
    expect(await sweeper.sweep(later)).toEqual([]);
  });
});

describe("the artist's Stripe account", () => {
  it("is created once and returns an onboarding link each time", async () => {
    const artist = await t.prisma.artist.findFirstOrThrow();
    await t.prisma.artist.update({ where: { id: artist.id }, data: { stripeAccountId: null } });

    const first = await t.request<StripeOnboardingDto>(
      "POST",
      `/artists/${artist.id}/stripe-account`,
    );
    const second = await t.request<StripeOnboardingDto>(
      "POST",
      `/artists/${artist.id}/stripe-account`,
    );

    expect(first.status).toBe(200);
    expect(first.body.onboardingUrl).toContain(first.body.stripeAccountId);
    expect(second.body.stripeAccountId).toBe(first.body.stripeAccountId);
    expect(t.payments.accounts).toHaveLength(1);
    const updated = await t.prisma.artist.findUniqueOrThrow({ where: { id: artist.id } });
    expect(updated.stripeAccountId).toBe(first.body.stripeAccountId);
  });
});

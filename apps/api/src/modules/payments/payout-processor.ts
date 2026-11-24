import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Payout, PrismaClient } from "@ledgerline/db";
import { addLogContext } from "../../common/logging.js";
import { PAYMENT_GATEWAY, PRISMA } from "../../common/tokens.js";
import { PaymentRefusedError, type PaymentGateway } from "./payment-gateway.js";
import { PayoutStateService } from "./payout-state.service.js";

export type PayoutOutcome = "transfer_created" | "failed" | "skipped";

export const PAYOUT_JOB_ACTOR = "system:payout-job";

// What one "send" job does (F7, docs/SYSTEM.md §8). Separate from the BullMQ Worker
// class so the tests can call it directly with a fake gateway.
//
// Safe to run any number of times for the same payout:
//   - it re-reads the payout first and stops if the work is done;
//   - every transfer call sends the payout's idempotency key, so a second call
//     after a crash or timeout gets the FIRST transfer back, never a new one.
@Injectable()
export class PayoutProcessor {
  private readonly logger = new Logger(PayoutProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    @Inject(PayoutStateService) private readonly payouts: PayoutStateService,
  ) {}

  async process(payoutId: string): Promise<PayoutOutcome> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { settlement: { include: { show: { include: { artist: true } } } } },
    });
    if (payout) {
      addLogContext({ settlementId: payout.settlementId });
    }
    if (!payout || payout.status === "succeeded" || payout.status === "failed") {
      this.logger.log(`payout ${payoutId}: nothing to do (${payout?.status ?? "not found"})`);
      return "skipped";
    }
    // The transfer exists; only the webhook's confirmation is missing. Calling
    // again would return the same transfer, so there is nothing to gain.
    if (payout.stripeTransferId !== null) {
      this.logger.log(
        `payout ${payoutId}: transfer ${payout.stripeTransferId} exists, waiting for the webhook`,
      );
      return "skipped";
    }
    if (this.gateway === null) {
      // A configuration problem, not a payment problem: retry, so the payout goes
      // out once the key is set (approval refuses without a key, so this is rare).
      throw new Error("Stripe is not configured (STRIPE_SECRET_KEY is not set).");
    }
    const destination = payout.settlement.show.artist.stripeAccountId;
    if (destination === null) {
      await this.fail(payout, "The artist has no Stripe account.");
      return "failed";
    }

    await this.prisma.$transaction((tx) =>
      this.payouts.markProcessing(tx, payout, PAYOUT_JOB_ACTOR),
    );

    let transferId: string;
    try {
      ({ transferId } = await this.gateway.createTransfer({
        amountCents: Number(payout.amountCents), // ≤ MAX_CENTS, so exact
        destinationAccountId: destination,
        idempotencyKey: payout.idempotencyKey,
        payoutId: payout.id,
        settlementId: payout.settlementId,
      }));
    } catch (error) {
      if (error instanceof PaymentRefusedError) {
        await this.fail(payout, error.reason);
        return "failed";
      }
      // We do not know whether the transfer was made. Leave the payout processing
      // and let BullMQ retry with the same key; after the last retry the sweeper
      // tries again later. Never mark it failed here: a retry by a person would
      // use a NEW key and could pay twice.
      throw error;
    }

    // If the process dies right here, the retry calls Stripe again with the same
    // key and gets this same transfer back (Break it 1).
    await this.prisma.$transaction((tx) =>
      this.payouts.recordTransfer(tx, payout, transferId, PAYOUT_JOB_ACTOR),
    );
    this.logger.log(`payout ${payoutId}: transfer ${transferId} created`);
    return "transfer_created";
  }

  private async fail(payout: Payout, reason: string): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.payouts.markFailed(tx, payout, reason, PAYOUT_JOB_ACTOR),
    );
    this.logger.warn(`payout ${payout.id}: failed: ${reason}`);
  }
}

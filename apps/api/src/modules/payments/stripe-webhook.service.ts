import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@ledgerline/db";
import type Stripe from "stripe";
import { PRISMA } from "../../common/tokens.js";
import { PayoutStateService } from "./payout-state.service.js";

export type WebhookOutcome = "paid" | "duplicate" | "ignored";

// Handles a Stripe event whose signature was already verified (StripeWebhookController).
//
// The webhook is the source of truth for "the money moved" (docs/SYSTEM.md §8): the
// job only knows Stripe accepted the request. For a transfer between Stripe
// balances, that confirmation is the transfer.created event.
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PayoutStateService) private readonly payouts: PayoutStateService,
  ) {}

  async handle(event: Stripe.Event): Promise<WebhookOutcome> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Dedupe first, in the same transaction as the effect. Stripe may deliver an
        // event twice; the second insert hits the primary key and we stop. If the
        // effect below fails, this insert rolls back too, so Stripe's retry is
        // handled properly instead of being skipped as a "duplicate".
        await tx.processedWebhookEvent.create({ data: { id: event.id, type: event.type } });

        if (event.type !== "transfer.created") {
          // transfer.reversed (money taken back) is out of scope for the MVP; it is
          // recorded as processed and logged so nobody misses it.
          this.logger.log(`event ${event.id} (${event.type}): not handled`);
          return "ignored";
        }
        const transfer = event.data.object;
        const payoutId = transfer.metadata?.["payoutId"];
        const payout = payoutId ? await tx.payout.findUnique({ where: { id: payoutId } }) : null;
        if (!payout) {
          this.logger.warn(`event ${event.id}: transfer ${transfer.id} matches no payout`);
          return "ignored";
        }
        // A transfer for a different amount than the approved one must never mark
        // the settlement paid. Recorded, logged, left for a person.
        if (BigInt(transfer.amount) !== payout.amountCents) {
          this.logger.error(
            `event ${event.id}: transfer ${transfer.id} is ${transfer.amount} cents, payout ${payout.id} is ${payout.amountCents}`,
          );
          return "ignored";
        }
        // The webhook can arrive before the job has saved the transfer id; the
        // payout id in the transfer's metadata finds it either way.
        const changed = await this.payouts.markSucceeded(
          tx,
          payout,
          transfer.id,
          `stripe:${event.id}`,
        );
        return changed ? "paid" : "ignored";
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return "duplicate";
      }
      throw error;
    }
  }
}

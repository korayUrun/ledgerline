import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@ledgerline/db";
import { PRISMA } from "../../common/tokens.js";
import { PayoutQueue } from "./payout-queue.js";

// A payout untouched for this long is considered stuck.
export const STUCK_AFTER_MS = 5 * 60_000;

// The safety net (docs/SYSTEM.md §8). Finds payouts that should be moving but are
// not, and puts them back on the queue:
//   - pending: approved, but the enqueue after the commit failed (Redis was down)
//     or the job was lost;
//   - processing without a transfer id: the job used up its retries on errors that
//     left the outcome unknown (Stripe unreachable for minutes).
// Re-sending is safe for the same reason retries are: the idempotency key.
// Processing WITH a transfer id is waiting for the webhook, so it is left alone.
@Injectable()
export class PayoutSweeper {
  private readonly logger = new Logger(PayoutSweeper.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PayoutQueue) private readonly queue: PayoutQueue,
  ) {}

  // `now` is a parameter so the tests can move the clock.
  async sweep(now: Date = new Date()): Promise<string[]> {
    const stuck = await this.prisma.payout.findMany({
      where: {
        updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
        OR: [{ status: "pending" }, { status: "processing", stripeTransferId: null }],
      },
      select: { id: true },
    });
    for (const { id } of stuck) {
      await this.queue.enqueue(id);
    }
    if (stuck.length > 0) {
      this.logger.warn(`re-enqueued ${stuck.length} stuck payout(s)`);
    }
    return stuck.map((payout) => payout.id);
  }
}

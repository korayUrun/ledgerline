import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { CONFIG } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";

export const PAYOUTS_QUEUE = "payouts";

// Two kinds of job on one queue (docs/SYSTEM.md §9):
//   "send"  — send one payout. Carries only the id: the worker re-reads the payout,
//             so it never acts on a stale copy.
//   "sweep" — every minute, re-enqueue payouts that are stuck (see PayoutSweeper).
export type PayoutJobData = { payoutId: string } | Record<string, never>;

// 1 try + 4 retries for "we do not know what happened" errors, waiting 10 s, 20 s,
// 40 s, 80 s. Every retry sends the same idempotency key, so retrying is safe.
export const PAYOUT_JOB_ATTEMPTS = 5;
export const SWEEP_EVERY_MS = 60_000;

@Injectable()
export class PayoutQueue implements OnApplicationShutdown {
  private readonly queue: Queue<PayoutJobData>;

  constructor(@Inject(CONFIG) config: ApiConfig) {
    this.queue = new Queue<PayoutJobData>(PAYOUTS_QUEUE, {
      connection: { url: config.redisUrl },
    });
  }

  async enqueue(payoutId: string): Promise<void> {
    await this.queue.add(
      "send",
      { payoutId },
      {
        // The payout id as job id: while a job for this payout exists, a second add
        // is ignored, so a double enqueue cannot start two senders at once.
        jobId: payoutId,
        attempts: PAYOUT_JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: 10_000 },
        // Finished jobs are removed at once, so the sweeper can enqueue the same
        // payout again later if it is still stuck.
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  // Called once by the worker at startup. Upserting means a restart does not add a
  // second schedule.
  async scheduleSweeper(): Promise<void> {
    await this.queue.upsertJobScheduler(
      "payout-sweeper",
      { every: SWEEP_EVERY_MS },
      { name: "sweep", data: {} },
    );
  }

  // For tests and debugging: what BullMQ knows about a payout's job.
  async jobState(payoutId: string): Promise<string | null> {
    const job = await this.queue.getJob(payoutId);
    return job ? job.getState() : null;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

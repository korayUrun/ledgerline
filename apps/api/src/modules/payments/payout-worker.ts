import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { Worker } from "bullmq";
import { withLogContext } from "../../common/logging.js";
import { CONFIG } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";
import { PayoutProcessor } from "./payout-processor.js";
import { PAYOUTS_QUEUE, PayoutQueue, type PayoutJobData } from "./payout-queue.js";
import { PayoutSweeper } from "./payout-sweeper.js";

// The BullMQ consumer for the payouts queue. Only the worker process creates it.
@Injectable()
export class PayoutWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PayoutWorker.name);
  private worker: Worker<PayoutJobData> | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(PayoutProcessor) private readonly processor: PayoutProcessor,
    @Inject(PayoutSweeper) private readonly sweeper: PayoutSweeper,
    @Inject(PayoutQueue) private readonly queue: PayoutQueue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.scheduleSweeper();
    this.worker = new Worker<PayoutJobData>(
      PAYOUTS_QUEUE,
      // Every line logged while the job runs carries its jobId; the processor adds
      // the settlementId once it has read the payout.
      (job) =>
        withLogContext({ jobId: `${PAYOUTS_QUEUE}:${job.id}` }, async () => {
          if (job.name === "sweep") {
            await this.sweeper.sweep();
            return;
          }
          if (!("payoutId" in job.data)) {
            throw new Error(`job ${job.id}: no payoutId`);
          }
          const outcome = await this.processor.process(job.data.payoutId);
          this.logger.log(`job ${job.id} attempt ${job.attemptsStarted}: ${outcome}`);
        }),
      // One payout at a time: the volume is tiny and it keeps the logs readable.
      { connection: { url: this.config.redisUrl }, concurrency: 1 },
    );
    this.worker.on("failed", (job, error) => {
      withLogContext({ jobId: `${PAYOUTS_QUEUE}:${job?.id}` }, () => {
        this.logger.warn(`job ${job?.id} attempt ${job?.attemptsStarted} failed: ${error.message}`);
      });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}

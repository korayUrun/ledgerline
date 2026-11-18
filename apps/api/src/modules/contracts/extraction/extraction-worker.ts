import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { Worker } from "bullmq";
import type { ApiConfig } from "../../../config.js";
import { CONFIG } from "../../../common/tokens.js";
import { ExtractionProcessor } from "./extraction-processor.js";
import { CONTRACT_EXTRACTION_QUEUE, type ExtractionJobData } from "./extraction-queue.js";

// The BullMQ consumer. Only the worker process (src/worker.ts) creates it, so a
// slow Claude call never holds up an HTTP request, and an API restart never
// kills an extraction in progress.
@Injectable()
export class ExtractionWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ExtractionWorker.name);
  private worker: Worker<ExtractionJobData> | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(ExtractionProcessor) private readonly processor: ExtractionProcessor,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<ExtractionJobData>(
      CONTRACT_EXTRACTION_QUEUE,
      async (job) => {
        // attemptsStarted is the number of this attempt (1, 2, 3).
        const isLastAttempt = job.attemptsStarted >= (job.opts.attempts ?? 1);
        const outcome = await this.processor.process(job.data.contractId, { isLastAttempt });
        this.logger.log(`job ${job.id} attempt ${job.attemptsStarted}: ${outcome}`);
      },
      // Two extractions at a time: each one mostly waits on Claude.
      { connection: { url: this.config.redisUrl }, concurrency: 2 },
    );
    this.worker.on("failed", (job, error) => {
      this.logger.warn(`job ${job?.id} attempt ${job?.attemptsStarted} failed: ${error.message}`);
    });
  }

  // Waits for running jobs to finish before the process exits.
  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}

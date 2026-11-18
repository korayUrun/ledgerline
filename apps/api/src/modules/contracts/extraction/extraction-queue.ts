import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import type { ApiConfig } from "../../../config.js";
import { CONFIG } from "../../../common/tokens.js";

export const CONTRACT_EXTRACTION_QUEUE = "contract-extraction";

// Jobs carry an id, never the data (docs/SYSTEM.md §9). The worker re-reads the
// contract from the database, so it always acts on the current state.
export type ExtractionJobData = { contractId: string };

// 1 try + 2 retries for unexpected errors (network down after the SDK's own
// retries, database hiccup…), waiting 5 s, then 10 s. An extraction that fails
// validation is NOT retried here: the extractor already retried with the errors.
export const EXTRACTION_JOB_ATTEMPTS = 3;

// The producer side, used by the HTTP API. The consumer is ExtractionWorker,
// which only runs in the worker process (src/worker.ts).
@Injectable()
export class ExtractionQueue implements OnApplicationShutdown {
  private readonly queue: Queue<ExtractionJobData>;

  constructor(@Inject(CONFIG) config: ApiConfig) {
    this.queue = new Queue<ExtractionJobData>(CONTRACT_EXTRACTION_QUEUE, {
      connection: { url: config.redisUrl },
    });
  }

  async enqueue(contractId: string): Promise<void> {
    await this.queue.add(
      "extract",
      { contractId },
      {
        // The contract id as job id: BullMQ ignores a second add with the same id,
        // so a double submit can never start two extractions (and two bills).
        jobId: contractId,
        attempts: EXTRACTION_JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: 5_000 },
        // Keep the last 1,000 finished jobs for debugging, then let Redis forget them.
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 1_000 },
      },
    );
  }

  // For tests and debugging: what BullMQ knows about a contract's job.
  async jobState(contractId: string): Promise<string | null> {
    const job = await this.queue.getJob(contractId);
    return job ? job.getState() : null;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

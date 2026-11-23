import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@ledgerline/db";
import { CONFIG, LLM_CLIENT, PRISMA } from "./common/tokens.js";
import type { ApiConfig } from "./config.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { ContractFileStorage } from "./modules/contracts/contract-file-storage.js";
import { ContractStateMachine } from "./modules/contracts/contract-state-machine.js";
import { ExtractionProcessor } from "./modules/contracts/extraction/extraction-processor.js";
import { ExtractionWorker } from "./modules/contracts/extraction/extraction-worker.js";
import { createLlmClient } from "./modules/llm/create-llm-client.js";
import type { LlmClient } from "./modules/llm/llm-client.js";

export type WorkerOptions = {
  // Tests pass a scripted fake here instead of building one from config.
  llmClient?: LlmClient;
  // Tests that call ExtractionProcessor directly turn the BullMQ consumer off.
  startQueueConsumer?: boolean;
};

// The worker process: the same codebase as the API, a different entry point
// (docs/SYSTEM.md §3). No HTTP server and no controllers, just the job consumers
// and what they need.
@Module({})
export class WorkerModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  static register(config: ApiConfig, options: WorkerOptions = {}): DynamicModule {
    return {
      module: WorkerModule,
      global: true,
      imports: [AuditModule],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: PRISMA, useFactory: () => createPrismaClient(config.databaseUrl) },
        {
          provide: LLM_CLIENT,
          useFactory: () => options.llmClient ?? createLlmClient(config.llm),
        },
        ContractStateMachine,
        ContractFileStorage,
        ExtractionProcessor,
        ...(options.startQueueConsumer === false ? [] : [ExtractionWorker]),
      ],
      exports: [CONFIG, PRISMA],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

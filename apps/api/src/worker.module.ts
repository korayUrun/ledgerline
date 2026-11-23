import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@ledgerline/db";
import { CONFIG, LLM_CLIENT, PAYMENT_GATEWAY, PRISMA } from "./common/tokens.js";
import type { ApiConfig } from "./config.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { ContractFileStorage } from "./modules/contracts/contract-file-storage.js";
import { ContractStateMachine } from "./modules/contracts/contract-state-machine.js";
import { ExtractionProcessor } from "./modules/contracts/extraction/extraction-processor.js";
import { ExtractionWorker } from "./modules/contracts/extraction/extraction-worker.js";
import { createLlmClient } from "./modules/llm/create-llm-client.js";
import type { LlmClient } from "./modules/llm/llm-client.js";
import { createPaymentGateway } from "./modules/payments/create-payment-gateway.js";
import type { PaymentGateway } from "./modules/payments/payment-gateway.js";
import { PayoutProcessor } from "./modules/payments/payout-processor.js";
import { PayoutQueue } from "./modules/payments/payout-queue.js";
import { PayoutStateService } from "./modules/payments/payout-state.service.js";
import { PayoutSweeper } from "./modules/payments/payout-sweeper.js";
import { PayoutWorker } from "./modules/payments/payout-worker.js";
import { SettlementStateMachine } from "./modules/settlements/settlement-state-machine.js";

export type WorkerOptions = {
  // Tests pass a scripted fake here instead of building one from config.
  llmClient?: LlmClient;
  paymentGateway?: PaymentGateway;
  // Tests that call the processors directly turn the BullMQ consumers off.
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
        {
          provide: PAYMENT_GATEWAY,
          useFactory: () => options.paymentGateway ?? createPaymentGateway(config.stripe),
        },
        ContractStateMachine,
        ContractFileStorage,
        ExtractionProcessor,
        // Payouts (F7): the job that sends the money, and the sweeper.
        SettlementStateMachine,
        PayoutStateService,
        PayoutProcessor,
        PayoutQueue,
        PayoutSweeper,
        ...(options.startQueueConsumer === false ? [] : [ExtractionWorker, PayoutWorker]),
      ],
      exports: [CONFIG, PRISMA],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

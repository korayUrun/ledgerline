import {
  Controller,
  Get,
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@ledgerline/db";
import { CONFIG, LLM_CLIENT, PAYMENT_GATEWAY, PRISMA } from "./common/tokens.js";
import type { ApiConfig } from "./config.js";
import { AgentModule } from "./modules/agent/agent.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { Public } from "./modules/auth/auth.guard.js";
import { ContractsModule } from "./modules/contracts/contracts.module.js";
import { createPaymentGateway } from "./modules/payments/create-payment-gateway.js";
import type { PaymentGateway } from "./modules/payments/payment-gateway.js";
import { PaymentsModule } from "./modules/payments/payments.module.js";
import { createLlmClient } from "./modules/llm/create-llm-client.js";
import type { LlmClient } from "./modules/llm/llm-client.js";
import { SettlementsModule } from "./modules/settlements/settlements.module.js";
import { ShowsModule } from "./modules/shows/shows.module.js";

@Controller("health")
class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // Also touches the database, so "ok" means the API can actually serve requests.
  // Public: monitoring checks it without logging in.
  @Public()
  @Get()
  async check(): Promise<{ status: "ok" }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  }
}

export type AppOptions = {
  // Tests pass a scripted fake here instead of building one from config.
  llmClient?: LlmClient;
  paymentGateway?: PaymentGateway;
};

// The root module. register(config) instead of a static @Module so the config is
// passed in from outside: main.ts reads it from the environment, the integration
// tests pass a throwaway database.
@Module({})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  static register(config: ApiConfig, options: AppOptions = {}): DynamicModule {
    return {
      module: AppModule,
      // global: the config, the Prisma client and the LLM client can be injected in
      // every feature module without each one importing them.
      global: true,
      imports: [
        AuthModule,
        AuditModule,
        SettlementsModule,
        ShowsModule,
        ContractsModule,
        AgentModule,
        PaymentsModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: CONFIG, useValue: config },
        // One client (one connection pool) for the whole app.
        { provide: PRISMA, useFactory: () => createPrismaClient(config.databaseUrl) },
        // For the audit agent, which runs in the API so its answer can stream.
        {
          provide: LLM_CLIENT,
          useFactory: () => options.llmClient ?? createLlmClient(config.llm),
        },
        // Stripe (test mode), or null when no key is set.
        {
          provide: PAYMENT_GATEWAY,
          useFactory: () => options.paymentGateway ?? createPaymentGateway(config.stripe),
        },
      ],
      exports: [CONFIG, PRISMA, LLM_CLIENT, PAYMENT_GATEWAY],
    };
  }

  // Close the pool on shutdown, so tests and `tsx watch` restarts do not leak connections.
  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

import {
  Controller,
  Get,
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@ledgerline/db";
import { ActorService } from "./common/actor.service.js";
import { CONFIG, PRISMA } from "./common/tokens.js";
import type { ApiConfig } from "./config.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { ContractsModule } from "./modules/contracts/contracts.module.js";
import { SettlementsModule } from "./modules/settlements/settlements.module.js";
import { ShowsModule } from "./modules/shows/shows.module.js";

@Controller("health")
class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // Also touches the database, so "ok" means the API can actually serve requests.
  @Get()
  async check(): Promise<{ status: "ok" }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  }
}

// The root module. register(config) instead of a static @Module so the config is
// passed in from outside: main.ts reads it from the environment, the integration
// tests pass a throwaway database.
@Module({})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      // global: the config, the Prisma client and ActorService can be injected in
      // every feature module without each one importing them.
      global: true,
      imports: [AuditModule, SettlementsModule, ShowsModule, ContractsModule],
      controllers: [HealthController],
      providers: [
        { provide: CONFIG, useValue: config },
        // One client (one connection pool) for the whole app.
        { provide: PRISMA, useFactory: () => createPrismaClient(config.databaseUrl) },
        ActorService,
      ],
      exports: [CONFIG, PRISMA, ActorService],
    };
  }

  // Close the pool on shutdown, so tests and `tsx watch` restarts do not leak connections.
  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

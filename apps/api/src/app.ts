import "reflect-metadata"; // Nest reads decorator data through the Reflect API; must load first
import type { INestApplication, LogLevel } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import type { ApiConfig } from "./config.js";

// Builds the app without listening on a port. main.ts and the integration tests
// share this, so the tests run exactly the app that runs in development.
export async function createApp(
  config: ApiConfig,
  logLevels: LogLevel[] = ["error", "warn", "log"],
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config), { logger: logLevels });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}

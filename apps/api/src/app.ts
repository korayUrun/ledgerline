import "reflect-metadata"; // Nest reads decorator data through the Reflect API; must load first
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule, type AppOptions } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { NestPinoLogger, type Logger } from "./common/logging.js";
import type { ApiConfig } from "./config.js";
import { serveOpenApiDocument } from "./modules/public-api/openapi.js";

// Builds the app without listening on a port. main.ts and the integration tests
// share this, so the tests run exactly the app that runs in development.
export async function createApp(
  config: ApiConfig,
  logger: Logger,
  options: AppOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config, logger, options), {
    // Nest's own lines and every `new Logger(...)` in our code go through pino.
    logger: new NestPinoLogger(logger),
    // Keeps the exact request bytes next to the parsed JSON: the Stripe webhook
    // signature is computed over those bytes.
    rawBody: true,
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  // GET /v1/openapi.json and the browsable /v1/docs (F9).
  serveOpenApiDocument(app);
  return app;
}

import "reflect-metadata"; // Nest reads decorator data through the Reflect API; must load first
import { NestFactory } from "@nestjs/core";
import { createLogger, NestPinoLogger } from "./common/logging.js";
import { readConfigFromEnv, readLogConfigFromEnv } from "./config.js";
import { WorkerModule } from "./worker.module.js";

// The background worker (F8): takes contract-extraction and payout jobs from Redis.
// `pnpm --filter @ledgerline/api dev` starts it next to the HTTP API.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the environment.
}

const logger = createLogger(readLogConfigFromEnv());
const config = readConfigFromEnv();
// An application context: Nest's dependency injection without an HTTP server.
const app = await NestFactory.createApplicationContext(WorkerModule.register(config), {
  logger: new NestPinoLogger(logger),
});
// Ctrl-C / SIGTERM → onApplicationShutdown → running jobs finish, connections close.
app.enableShutdownHooks();
logger.info(
  {
    llm: config.llm.client,
    model: config.llm.extractionModel,
    stripe: config.stripe.secretKey ? "test" : "off",
    redis: new URL(config.redisUrl).host,
  },
  "worker started",
);

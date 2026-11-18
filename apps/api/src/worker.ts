import "reflect-metadata"; // Nest reads decorator data through the Reflect API; must load first
import { NestFactory } from "@nestjs/core";
import { readWorkerConfigFromEnv } from "./config.js";
import { WorkerModule } from "./worker.module.js";

// The background worker (F8): takes contract-extraction jobs from Redis.
// `pnpm --filter @ledgerline/api dev` starts it next to the HTTP API.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the environment.
}

const config = readWorkerConfigFromEnv();
// An application context: Nest's dependency injection without an HTTP server.
const app = await NestFactory.createApplicationContext(WorkerModule.register(config), {
  logger: ["error", "warn", "log"],
});
// Ctrl-C / SIGTERM → onApplicationShutdown → running jobs finish, connections close.
app.enableShutdownHooks();
console.log(
  `Worker started (llm=${config.llm.client}, model=${config.llm.extractionModel}, redis=${new URL(config.redisUrl).host})`,
);

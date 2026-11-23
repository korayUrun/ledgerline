import { createApp } from "./app.js";
import { createLogger } from "./common/logging.js";
import { readConfigFromEnv, readLogConfigFromEnv } from "./config.js";

// Load the repo-root .env for local development. In CI or production the
// variables come from the environment and the file does not exist.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the environment.
}

const logger = createLogger(readLogConfigFromEnv());
const config = readConfigFromEnv();
const app = await createApp(config, logger);
await app.listen(config.port);
logger.info({ port: config.port }, `API listening on http://localhost:${config.port}`);

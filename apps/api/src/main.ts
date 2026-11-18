import { createApp } from "./app.js";
import { readConfigFromEnv } from "./config.js";

// Load the repo-root .env for local development. In CI or production the
// variables come from the environment and the file does not exist.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the environment.
}

const config = readConfigFromEnv();
const app = await createApp(config);
await app.listen(config.port);
console.log(`API listening on http://localhost:${config.port}`);

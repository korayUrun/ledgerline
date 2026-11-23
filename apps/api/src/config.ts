import { fileURLToPath } from "node:url";

export type ApiConfig = {
  databaseUrl: string;
  // BullMQ queues live in Redis. The API adds jobs, the worker takes them.
  redisUrl: string;
  port: number;
  // Root folder for uploaded files. A key such as "receipts/<uuid>.pdf" or
  // "contracts/<uuid>.pdf" is stored relative to it. API and worker must share it.
  storageDir: string;
  llm: LlmConfig;
};

export type LlmConfig = {
  // "anthropic" calls Claude. "fake" never calls the network: every contract comes
  // back as "nothing found" (a person types the terms in the review screen) and the
  // agent answers that it is offline. For running the whole flow without an API key.
  client: "anthropic" | "fake";
  apiKey: string | null;
  extractionModel: string;
  // The audit agent's model (F6). Chosen by the agent eval; Sonnet until then,
  // because an audit makes many calls and Opus costs more per token.
  agentModel: string;
  timeoutMs: number;
  maxRetries: number; // SDK retries on 429/5xx/connection errors, per call
};

// Read once at startup, then passed into AppModule. Modules never read process.env
// themselves, which is what lets the integration tests start the app against a
// throwaway database just by passing a different config.
//
// The API and the worker read the same config. Both call Claude: the worker to read
// contracts, the API to run the audit agent (its answers stream to the browser).
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  }
  const redisUrl = env["REDIS_URL"];
  if (!redisUrl) {
    throw new Error("REDIS_URL is not set (copy .env.example to .env)");
  }
  return {
    databaseUrl,
    redisUrl,
    port: Number(env["API_PORT"] ?? 3001),
    storageDir:
      env["STORAGE_DIR"] ?? fileURLToPath(new URL("../../../var/storage", import.meta.url)),
    llm: readLlmConfig(env),
  };
}

function readLlmConfig(env: NodeJS.ProcessEnv): LlmConfig {
  const client = env["LLM_CLIENT"] ?? "anthropic";
  if (client !== "anthropic" && client !== "fake") {
    throw new Error(`LLM_CLIENT must be "anthropic" or "fake", got "${client}"`);
  }
  const apiKey = env["ANTHROPIC_API_KEY"] || null;
  if (client === "anthropic" && apiKey === null) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env, or set LLM_CLIENT=fake to run without Claude.",
    );
  }
  return {
    client,
    apiKey,
    extractionModel: env["EXTRACTION_MODEL"] ?? "claude-opus-5-5",
    agentModel: env["AGENT_MODEL"] ?? "claude-sonnet-5-5",
    timeoutMs: Number(env["LLM_TIMEOUT_MS"] ?? 120_000),
    maxRetries: Number(env["LLM_MAX_RETRIES"] ?? 3),
  };
}

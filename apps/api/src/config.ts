import { fileURLToPath } from "node:url";

export type ApiConfig = {
  databaseUrl: string;
  // BullMQ queues live in Redis. The API adds jobs, the worker takes them.
  redisUrl: string;
  port: number;
  // Root folder for uploaded files. A key such as "receipts/<uuid>.pdf" or
  // "contracts/<uuid>.pdf" is stored relative to it. API and worker must share it.
  storageDir: string;
};

export type LlmConfig = {
  // "anthropic" calls Claude. "fake" never calls the network: every contract comes
  // back as "nothing found" and a person types the terms in the review screen.
  // For running the whole flow locally without an API key.
  client: "anthropic" | "fake";
  apiKey: string | null;
  extractionModel: string;
  timeoutMs: number;
  maxRetries: number; // SDK retries on 429/5xx/connection errors, per call
};

export type WorkerConfig = ApiConfig & { llm: LlmConfig };

// Read once at startup, then passed into AppModule. Modules never read process.env
// themselves, which is what lets the integration tests start the app against a
// throwaway database just by passing a different config.
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
  };
}

// The worker needs everything the API needs, plus the Claude settings. Only the
// worker reads the API key: the HTTP API never calls Claude.
export function readWorkerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
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
    ...readConfigFromEnv(env),
    llm: {
      client,
      apiKey,
      extractionModel: env["EXTRACTION_MODEL"] ?? "claude-opus-5-5",
      timeoutMs: Number(env["LLM_TIMEOUT_MS"] ?? 120_000),
      maxRetries: Number(env["LLM_MAX_RETRIES"] ?? 3),
    },
  };
}

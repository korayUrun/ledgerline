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
  stripe: StripeConfig;
  // Where people open the web app; Stripe's onboarding page sends them back here.
  webUrl: string;
  publicApi: PublicApiConfig;
};

// The /v1 API (F9). Each API key may make this many requests per minute; the next
// one gets 429 with Retry-After until the minute is over.
export type PublicApiConfig = {
  rateLimitPerMinute: number;
};

// Stripe test mode (F7). Both are optional so the app runs without them: approving
// then answers 503 ("payments are not configured") and the webhook endpoint 503.
export type StripeConfig = {
  secretKey: string | null; // "sk_test_…"; a live key is refused at startup
  webhookSecret: string | null; // "whsec_…", printed by `stripe listen`
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

// Logging (docs/SYSTEM.md §12). Separate from ApiConfig because the logger exists
// before the app does: main.ts and worker.ts create it first and hand it to Nest.
export type LogConfig = {
  level: LogLevelName;
  // "json": one JSON object per line (default, what a log tool reads).
  // "pretty": the same fields as readable text, for a terminal.
  format: "json" | "pretty";
};

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

export function readLogConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LogConfig {
  const level = env["LOG_LEVEL"] || "info";
  if (!(LOG_LEVELS as readonly string[]).includes(level)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got "${level}"`);
  }
  const format = env["LOG_FORMAT"] || "json";
  if (format !== "json" && format !== "pretty") {
    throw new Error(`LOG_FORMAT must be "json" or "pretty", got "${format}"`);
  }
  return { level: level as LogLevelName, format };
}

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
    stripe: readStripeConfig(env),
    webUrl: env["WEB_URL"] ?? "http://localhost:3000",
    publicApi: { rateLimitPerMinute: readPositiveInt(env, "V1_RATE_LIMIT_PER_MINUTE", 60) },
  };
}

// A typo such as "6O" must stop startup, not turn into NaN and disable the limit.
function readPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const text = env[name];
  if (text === undefined || text === "") {
    return fallback;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a whole number of 1 or more, got "${text}"`);
  }
  return value;
}

function readStripeConfig(env: NodeJS.ProcessEnv): StripeConfig {
  const secretKey = env["STRIPE_SECRET_KEY"] || null;
  // Real money is out of scope (CLAUDE.md): refuse to start with a live key.
  if (secretKey !== null && !secretKey.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_…).");
  }
  return { secretKey, webhookSecret: env["STRIPE_WEBHOOK_SECRET"] || null };
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

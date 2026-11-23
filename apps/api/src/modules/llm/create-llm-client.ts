import { Logger } from "@nestjs/common";
import type { LlmConfig } from "../../config.js";
import { nothingFoundExtraction } from "../contracts/extraction/nothing-found.js";
import { FakeLlmClient, fakeTextMessage } from "./fake-llm-client.js";
import { AnthropicLlmClient, type LlmClient } from "./llm-client.js";

// Picks the real client or the offline fake from config (LLM_CLIENT).
export function createLlmClient(config: LlmConfig): LlmClient {
  const logger = new Logger("LlmClient");
  if (config.client === "fake") {
    logger.warn(
      "LLM_CLIENT=fake: contracts are not read (every field comes back as missing) and the agent is offline.",
    );
    // Zero tokens and a model with no price: the UI shows that nothing was billed.
    const offline = { model: "fake", inputTokens: 0, outputTokens: 0 };
    return new FakeLlmClient((params) =>
      // Only the agent sends tools; the extraction sends a document and wants JSON.
      params.tools
        ? fakeTextMessage(
            "The assistant is offline (LLM_CLIENT=fake). Set ANTHROPIC_API_KEY to use it.",
            offline,
          )
        : fakeTextMessage(JSON.stringify(nothingFoundExtraction()), offline),
    );
  }
  if (config.apiKey === null) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return new AnthropicLlmClient({
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    log: (line) => logger.log(line),
  });
}

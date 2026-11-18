// NestJS app with two entry points: src/main.ts (HTTP API) and src/worker.ts
// (BullMQ worker).
//
// The exports below are plain functions and classes (no Nest), for the eval runner
// in packages/evals: it must run exactly the extraction code production runs.
export {
  ExtractionFailedError,
  extractContractTerms,
  MAX_EXTRACTION_RETRIES,
  type ExtractionResult,
  type ExtractionUsage,
} from "./modules/contracts/extraction/extract-contract.js";
export { EXTRACTION_PROMPT_VERSION } from "./modules/contracts/extraction/extraction-prompt.js";
export { FakeLlmClient, fakeTextMessage } from "./modules/llm/fake-llm-client.js";
export { AnthropicLlmClient, type LlmClient } from "./modules/llm/llm-client.js";
export { costNanoUsd, formatNanoUsd } from "./modules/llm/pricing.js";

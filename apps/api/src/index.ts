// NestJS app with two entry points: src/main.ts (HTTP API) and src/worker.ts
// (BullMQ worker).
//
// The exports below are plain functions and classes (no Nest), for the eval runner
// in packages/evals: it must run exactly the extraction and agent code production runs.
export {
  ExtractionFailedError,
  extractContractTerms,
  MAX_EXTRACTION_RETRIES,
  type ExtractionResult,
  type ExtractionUsage,
} from "./modules/contracts/extraction/extract-contract.js";
export { EXTRACTION_PROMPT_VERSION } from "./modules/contracts/extraction/extraction-prompt.js";
export {
  FakeLlmClient,
  fakeTextMessage,
  fakeToolUseMessage,
} from "./modules/llm/fake-llm-client.js";
// The audit agent (F6), for the agent eval: the same loop, tools and prompt.
export {
  runAgent,
  type AgentRunResult,
  type AgentStep,
  type AgentTool,
} from "./modules/agent/agent-loop.js";
export {
  AGENT_LIMITS,
  AGENT_PROMPT_VERSION,
  AGENT_SYSTEM_PROMPT,
  AUDIT_QUESTION,
} from "./modules/agent/agent-prompt.js";
export {
  buildAuditTools,
  type AuditContext,
  type AuditExpense,
  type FlagExpense,
} from "./modules/agent/tools/index.js";
export { AnthropicLlmClient, type LlmClient } from "./modules/llm/llm-client.js";
export { costNanoUsd, formatNanoUsd } from "./modules/llm/pricing.js";

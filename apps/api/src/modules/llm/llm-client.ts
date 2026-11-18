import Anthropic from "@anthropic-ai/sdk";
import { costNanoUsd, formatNanoUsd } from "./pricing.js";

// Every Claude call in the app goes through an LlmClient (docs/SYSTEM.md §7).
// One small interface, so the code that builds prompts (extraction now, the agent
// in Phase 4) can be tested with a fake that never touches the network.

export type LlmCallUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number; // includes thinking tokens
  costNanoUsd: number | null; // null = model not in the price table
  durationMs: number;
};

export type LlmResponse = { message: Anthropic.Message; usage: LlmCallUsage };

export interface LlmClient {
  // `task` is a short label for the logs, e.g. "contract-extraction".
  createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
    task: string,
  ): Promise<LlmResponse>;
}

export type AnthropicLlmOptions = {
  apiKey: string;
  timeoutMs: number;
  // Retries for 408/409/429/5xx and dropped connections, with exponential backoff
  // and the Retry-After header respected. The SDK already implements this
  // correctly, so we configure it instead of writing our own retry loop.
  maxRetries: number;
  log: (line: string) => void;
};

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicLlmOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs, // milliseconds in the TypeScript SDK
      maxRetries: options.maxRetries,
    });
  }

  async createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
    task: string,
  ): Promise<LlmResponse> {
    const startedAt = Date.now();
    const message = await this.client.messages.create(params);
    const usage = usageOf(message, Date.now() - startedAt);
    // Tokens and cost only. Prompt and reply text are never logged: they hold
    // contract content, and the key never appears anywhere near here.
    this.options.log(
      `llm task=${task} model=${usage.model} stop=${message.stop_reason} in=${usage.inputTokens} out=${usage.outputTokens} cost=${formatNanoUsd(usage.costNanoUsd)} ms=${usage.durationMs}`,
    );
    return { message, usage };
  }
}

export function usageOf(message: Anthropic.Message, durationMs: number): LlmCallUsage {
  const tokens = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
  return {
    model: message.model,
    ...tokens,
    costNanoUsd: costNanoUsd(message.model, tokens),
    durationMs,
  };
}

import type Anthropic from "@anthropic-ai/sdk";
import { usageOf, type LlmClient, type LlmResponse } from "./llm-client.js";

// An LlmClient that never calls the network. `respond` decides the reply, so a
// test can script exactly what "Claude" says on each attempt. Every request is
// kept in `requests`, so a test can check what we sent (e.g. that a retry carries
// the validation errors).
//
// Also used when the worker runs with LLM_CLIENT=fake (no API key needed): then
// it answers every contract with "nothing found", and a person fills in the terms.
export class FakeLlmClient implements LlmClient {
  readonly requests: Anthropic.MessageCreateParamsNonStreaming[] = [];

  constructor(
    private readonly respond: (
      params: Anthropic.MessageCreateParamsNonStreaming,
      attempt: number,
    ) => Anthropic.Message,
  ) {}

  createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<LlmResponse> {
    // A deep copy: the caller keeps appending to its messages array, and the test
    // must see each request as it was when it was sent. A JSON round trip rather
    // than structuredClone, because it is exactly what the SDK puts on the wire
    // (the output format carries a parse() function, which JSON simply drops).
    this.requests.push(JSON.parse(JSON.stringify(params)) as typeof params);
    const message = this.respond(params, this.requests.length);
    return Promise.resolve({ message, usage: usageOf(message, 0) });
  }
}

// A minimal Message with one text block, as the API returns for structured output.
export function fakeTextMessage(
  text: string,
  options: { stopReason?: Anthropic.StopReason; model?: string } = {},
): Anthropic.Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: options.model ?? "claude-opus-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: options.stopReason ?? "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    diagnostics: null,
    usage: {
      input_tokens: 5_000,
      output_tokens: 800,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
      speed: null,
    },
  };
}

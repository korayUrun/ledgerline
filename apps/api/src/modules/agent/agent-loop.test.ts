import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  FakeLlmClient,
  fakeMessage,
  fakeTextMessage,
  fakeToolUseMessage,
} from "../llm/fake-llm-client.js";
import { runAgent, ToolError, type AgentStep, type AgentTool } from "./agent-loop.js";

const LIMITS = { maxSteps: 5, tokenBudget: 1_000_000 };

// Scripted replies: model call 1 gets replies[0], call 2 replies[1], …
function scripted(...replies: Anthropic.Message[]): FakeLlmClient {
  return new FakeLlmClient((_params, call) => {
    const reply = replies[call - 1];
    if (!reply) throw new Error(`no scripted reply for model call ${call}`);
    return reply;
  });
}

// A tool that echoes its input, so a test can see exactly what it was called with.
function echoTool(): AgentTool<z.ZodObject<{ expenseId: z.ZodString }>> & {
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    name: "get_expense",
    description: "Returns one expense.",
    inputSchema: z.object({ expenseId: z.string().min(1) }),
    calls,
    run(input) {
      calls.push(input);
      return Promise.resolve({ id: input.expenseId, amountCents: 1_200 });
    },
  };
}

async function run(llm: FakeLlmClient, tools: AgentTool[], limits = LIMITS) {
  const steps: AgentStep[] = [];
  const result = await runAgent(llm, {
    model: "claude-opus-5-5",
    system: "You audit settlements.",
    tools,
    question: "Why is the payout $4,200?",
    limits,
    onStep: (step) => {
      steps.push(step);
      return Promise.resolve();
    },
  });
  return { result, steps };
}

// The tool_result blocks of the last user message in a request.
function toolResultsOf(request: Anthropic.MessageCreateParamsNonStreaming) {
  const last = request.messages.at(-1)!;
  expect(last.role).toBe("user");
  return last.content as Anthropic.ToolResultBlockParam[];
}

describe("runAgent", () => {
  it("returns the text when the model answers without tools", async () => {
    const llm = scripted(fakeTextMessage("Because the guarantee is $4,200."));

    const { result, steps } = await run(llm, [echoTool()]);

    expect(result.outcome).toBe("answered");
    expect(result.finalText).toBe("Because the guarantee is $4,200.");
    expect(result.modelCalls).toBe(1);
    expect(steps.map((step) => step.kind)).toEqual(["model_call"]);
    expect(llm.requests[0]!.messages).toEqual([
      { role: "user", content: "Why is the payout $4,200?" },
    ]);
  });

  it("sends each tool as a strict JSON Schema built from its Zod schema", async () => {
    const llm = scripted(fakeTextMessage("ok"));

    await run(llm, [echoTool()]);

    expect(llm.requests[0]!.tools).toEqual([
      {
        name: "get_expense",
        description: "Returns one expense.",
        strict: true,
        // The API cannot enforce minLength in strict mode, so the SDK moves it into
        // the description. runToolCall still enforces it with Zod.
        input_schema: {
          type: "object",
          properties: { expenseId: { type: "string", description: "{minLength: 1}" } },
          required: ["expenseId"],
          additionalProperties: false,
        },
      },
    ]);
  });

  it("runs a requested tool and answers it with a tool_result carrying the same tool_use_id", async () => {
    const tool = echoTool();
    const toolUse = fakeToolUseMessage([
      { id: "toolu_1", name: "get_expense", input: { expenseId: "ex-1" } },
    ]);
    const llm = scripted(toolUse, fakeTextMessage("The expense is $12."));

    const { result, steps } = await run(llm, [tool]);

    expect(result.outcome).toBe("answered");
    expect(result.modelCalls).toBe(2);
    expect(tool.calls).toEqual([{ expenseId: "ex-1" }]);

    // Before: [user]. After one loop: [user, assistant (the reply as received),
    // user (tool results)].
    const second = llm.requests[1]!;
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1]).toEqual(
      JSON.parse(JSON.stringify({ role: "assistant", content: toolUse.content })),
    );
    expect(toolResultsOf(second)).toEqual([
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: '{"id":"ex-1","amountCents":1200}',
        is_error: false,
      },
    ]);

    expect(steps.map((step) => step.kind)).toEqual(["model_call", "tool_call", "model_call"]);
    expect(steps[1]).toEqual({
      kind: "tool_call",
      toolUseId: "toolu_1",
      toolName: "get_expense",
      input: { expenseId: "ex-1" },
      output: '{"id":"ex-1","amountCents":1200}',
      isError: false,
    });
  });

  it("answers several tool calls from one reply in a single user message, in order", async () => {
    const tool = echoTool();
    const llm = scripted(
      fakeToolUseMessage([
        { id: "toolu_a", name: "get_expense", input: { expenseId: "ex-1" } },
        { id: "toolu_b", name: "get_expense", input: { expenseId: "ex-2" } },
      ]),
      fakeTextMessage("done"),
    );

    await run(llm, [tool]);

    expect(tool.calls).toEqual([{ expenseId: "ex-1" }, { expenseId: "ex-2" }]);
    expect(toolResultsOf(llm.requests[1]!).map((block) => block.tool_use_id)).toEqual([
      "toolu_a",
      "toolu_b",
    ]);
  });

  it("does not run a tool with invalid input, and tells the model why", async () => {
    const tool = echoTool();
    const llm = scripted(
      fakeToolUseMessage([{ id: "toolu_1", name: "get_expense", input: { expenseId: "" } }]),
      fakeTextMessage("sorry"),
    );

    await run(llm, [tool]);

    expect(tool.calls).toEqual([]);
    const [toolResult] = toolResultsOf(llm.requests[1]!);
    expect(toolResult).toMatchObject({ tool_use_id: "toolu_1", is_error: true });
    expect(toolResult!.content).toMatch(/^Invalid input: expenseId: /);
  });

  it("answers an unknown tool name with an error result instead of crashing", async () => {
    const llm = scripted(
      fakeToolUseMessage([{ id: "toolu_1", name: "approve_settlement", input: {} }]),
      fakeTextMessage("I cannot approve."),
    );

    const { result } = await run(llm, [echoTool()]);

    expect(result.outcome).toBe("answered");
    expect(toolResultsOf(llm.requests[1]!)).toEqual([
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: 'Unknown tool "approve_settlement".',
        is_error: true,
      },
    ]);
  });

  it("sends a ToolError's message back to the model as an error result", async () => {
    const tool: AgentTool = {
      ...echoTool(),
      run: () => Promise.reject(new ToolError("No expense with id ex-9.")),
    };
    const llm = scripted(
      fakeToolUseMessage([{ id: "toolu_1", name: "get_expense", input: { expenseId: "ex-9" } }]),
      fakeTextMessage("That expense does not exist."),
    );

    const { result } = await run(llm, [tool]);

    expect(result.outcome).toBe("answered");
    expect(toolResultsOf(llm.requests[1]!)[0]).toMatchObject({
      content: "No expense with id ex-9.",
      is_error: true,
    });
  });

  it("treats a plain (non-async) tool the same: its return value and its ToolError", async () => {
    const answering: AgentTool = { ...echoTool(), name: "get_total", run: () => ({ total: "$9" }) };
    const failing: AgentTool = {
      ...echoTool(),
      run: () => {
        throw new ToolError("No expense with id ex-9.");
      },
    };
    const llm = scripted(
      fakeToolUseMessage([
        { id: "toolu_1", name: "get_total", input: { expenseId: "ex-1" } },
        { id: "toolu_2", name: "get_expense", input: { expenseId: "ex-9" } },
      ]),
      fakeTextMessage("Done."),
    );

    await run(llm, [answering, failing]);

    expect(toolResultsOf(llm.requests[1]!)).toMatchObject([
      { tool_use_id: "toolu_1", content: '{"total":"$9"}', is_error: false },
      { tool_use_id: "toolu_2", content: "No expense with id ex-9.", is_error: true },
    ]);
  });

  it("ends the run on any other tool error: the model cannot fix a broken database", async () => {
    const tool: AgentTool = {
      ...echoTool(),
      run: () => Promise.reject(new Error("connection refused")),
    };
    const llm = scripted(
      fakeToolUseMessage([{ id: "toolu_1", name: "get_expense", input: { expenseId: "ex-1" } }]),
    );

    await expect(run(llm, [tool])).rejects.toThrow("connection refused");
    expect(llm.requests).toHaveLength(1);
  });

  it("stops at the step limit, without running tools nobody would read", async () => {
    const tool = echoTool();
    // A model that never stops asking: the reason a step limit exists.
    const llm = new FakeLlmClient((_params, call) =>
      fakeToolUseMessage([
        { id: `toolu_${call}`, name: "get_expense", input: { expenseId: "ex-1" } },
      ]),
    );

    const { result } = await run(llm, [tool], { maxSteps: 3, tokenBudget: 1_000_000 });

    expect(result.outcome).toBe("step_limit");
    expect(result.modelCalls).toBe(3);
    expect(llm.requests).toHaveLength(3);
    expect(tool.calls).toHaveLength(2); // the third reply's tool call was not run
  });

  it("stops when the token budget is used up", async () => {
    const llm = new FakeLlmClient((_params, call) =>
      fakeToolUseMessage(
        [{ id: `toolu_${call}`, name: "get_expense", input: { expenseId: "ex-1" } }],
        { inputTokens: 4_000, outputTokens: 1_000 },
      ),
    );

    const { result } = await run(llm, [echoTool()], { maxSteps: 50, tokenBudget: 12_000 });

    // 5k tokens per call: 10k after two calls (under budget), 15k after three.
    expect(result.outcome).toBe("token_budget");
    expect(result.modelCalls).toBe(3);
    expect(result.usage).toMatchObject({ inputTokens: 12_000, outputTokens: 3_000 });
  });

  it("never runs a tool call from a reply cut off by max_tokens", async () => {
    const tool = echoTool();
    const llm = scripted(
      fakeToolUseMessage([{ id: "toolu_1", name: "get_expense", input: { expenseId: "ex" } }], {
        stopReason: "max_tokens",
      }),
    );

    const { result } = await run(llm, [tool]);

    expect(result.outcome).toBe("truncated");
    expect(result.stopReason).toBe("max_tokens");
    expect(tool.calls).toEqual([]);
  });

  it("reports a refusal", async () => {
    const llm = scripted(fakeTextMessage("", { stopReason: "refusal" }));

    const { result } = await run(llm, [echoTool()]);

    expect(result).toMatchObject({ outcome: "refused", finalText: null });
  });

  it("stops on a tool_use stop with no tool_use block instead of sending an empty message", async () => {
    const llm = scripted(fakeMessage([], { stopReason: "tool_use" }));

    const { result } = await run(llm, [echoTool()]);

    expect(result.outcome).toBe("unexpected_stop");
    expect(llm.requests).toHaveLength(1);
  });

  it("adds up tokens and cost over all model calls", async () => {
    const llm = scripted(
      fakeToolUseMessage([{ id: "toolu_1", name: "get_expense", input: { expenseId: "ex-1" } }], {
        inputTokens: 1_000,
        outputTokens: 100,
      }),
      fakeTextMessage("done", { inputTokens: 2_000, outputTokens: 200 }),
    );

    const { result } = await run(llm, [echoTool()]);

    // claude-opus-5-5: 4,000 nano-USD per input token, 20,000 per output token.
    expect(result.usage).toEqual({
      inputTokens: 3_000,
      outputTokens: 300,
      costNanoUsd: 3_000 * 4_000 + 300 * 20_000,
    });
  });

  it("fails the run when a step cannot be recorded", async () => {
    const llm = scripted(fakeTextMessage("ok"));
    const onStep = vi.fn().mockRejectedValue(new Error("db down"));

    await expect(
      runAgent(llm, {
        model: "claude-opus-5-5",
        system: "s",
        tools: [],
        question: "q",
        limits: LIMITS,
        onStep,
      }),
    ).rejects.toThrow("db down");
  });
});

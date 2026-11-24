import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// How a run ends ("answered", "step_limit"…). One list, shared with the database
// enum and the web app.
import type { AgentOutcome } from "@ledgerline/schemas";
import type { z } from "zod";
import { formatZodIssues } from "../../common/zod-issues.js";
import type { LlmCallUsage, LlmClient } from "../llm/llm-client.js";

// The audit agent's loop (F6, docs/SYSTEM.md §7.2), written by hand on purpose:
//
//   messages = [user: the question]
//   repeat:
//     reply = Claude(system, tools, messages)
//     end_turn → done: the reply's text is the answer
//     tool_use → run every requested tool, then append
//                  assistant: reply.content                (exactly as received)
//                  user:      one tool_result per tool_use (with the SAME tool_use_id)
//     anything else → stop, and report why
//   …until the step limit or the token budget says stop.
//
// A plain function with the LlmClient passed in, like extractContractTerms: the API
// runs it for a person's question, and the eval runner runs the very same code on
// the dataset, so the eval measures exactly what production runs.

// One tool the agent may call. The input schema is Zod: it becomes the JSON Schema
// Claude sees, and the same schema checks what Claude actually sends, because a
// tool_use input is model output, and model output is untrusted.
export interface AgentTool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  // The model decides when to call a tool from this text alone, so it says what
  // the tool returns AND when to use it.
  description: string;
  inputSchema: Schema;
  // Returns plain JSON data, or a Promise of it for a tool that does I/O (the loop
  // awaits either way and turns the data into the tool_result text). A tool that
  // only reads memory stays a plain function, and its errors are thrown, not
  // returned as rejected Promises.
  // Written as a method, not as `run: (input) => …`, on purpose: TypeScript then
  // accepts tools with different input types in one AgentTool[] list.
  run(input: z.output<Schema>): unknown;
}

// Thrown by a tool for a problem the model can fix, e.g. an expense id that does
// not exist. The message goes back to the model as an error tool_result, and the
// model can try again. Any other error (database down, a bug) ends the run: the
// model cannot fix those, and hiding them in a tool_result would make a broken run
// look like a normal one.
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export type AgentLimits = {
  // Model calls per run. Without a limit, a model that keeps calling tools (or a
  // tool that keeps saying "try again") loops forever.
  maxSteps: number;
  // Input + output tokens over the whole run. Every call resends the whole
  // conversation, so input tokens grow with each step: the step limit alone does
  // not bound the cost.
  tokenBudget: number;
};

// One entry of the trace (F12). The caller stores each one, so a run can be
// replayed step by step: what the model said, which tool it called with what
// input, and what came back.
export type AgentStep =
  | {
      kind: "model_call";
      stopReason: Anthropic.StopReason | null;
      content: Anthropic.ContentBlock[];
      usage: LlmCallUsage;
    }
  | {
      kind: "tool_call";
      toolUseId: string;
      toolName: string;
      input: unknown; // as the model sent it, before validation
      output: string; // exactly the text sent back in the tool_result
      isError: boolean;
    };

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  costNanoUsd: number | null; // null = some call used a model with no known price
};

export type AgentRunResult = {
  outcome: AgentOutcome;
  finalText: string | null; // only for "answered"
  stopReason: Anthropic.StopReason | null; // of the last model call
  modelCalls: number;
  usage: AgentUsage;
};

export type AgentRequest = {
  model: string;
  system: string;
  tools: readonly AgentTool[];
  question: string; // the first user message
  limits: AgentLimits;
  // The label in the LLM client's log line; the audit agent's when not given.
  task?: string;
  // Called once per step, in order, and awaited. The caller stores the trace (and
  // streams it to the browser). If storing a step fails, the run fails: a run that
  // cannot be replayed is not allowed (F12).
  onStep: (step: AgentStep) => Promise<void>;
};

// Room for thinking plus a long answer. Non-streaming calls must stay well under
// the SDK's HTTP timeout, which is why this is not higher.
const MAX_TOKENS_PER_CALL = 16_000;

export async function runAgent(llm: LlmClient, request: AgentRequest): Promise<AgentRunResult> {
  const toolsByName = new Map(request.tools.map((tool) => [tool.name, tool]));
  const toolDefinitions = request.tools.map(toToolDefinition);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: request.question }];
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, costNanoUsd: 0 };
  let modelCalls = 0;

  // Ends only through a return: each one is an outcome the caller records.
  while (true) {
    const response = await llm.createMessage(
      {
        model: request.model,
        max_tokens: MAX_TOKENS_PER_CALL,
        system: request.system,
        tools: toolDefinitions,
        messages,
        // Thinking is always on for this model; effort sets how hard it thinks.
        output_config: { effort: "medium" },
      },
      request.task ?? "settlement-agent",
    );
    modelCalls += 1;
    addUsage(usage, response.usage);
    const { message } = response;
    await request.onStep({
      kind: "model_call",
      stopReason: message.stop_reason,
      content: message.content,
      usage: response.usage,
    });

    const finish = (outcome: AgentOutcome, finalText: string | null = null): AgentRunResult => ({
      outcome,
      finalText,
      stopReason: message.stop_reason,
      modelCalls,
      usage,
    });

    // stop_reason decides what the content means, so it is checked first.
    switch (message.stop_reason) {
      case "end_turn":
        return finish("answered", textOf(message));
      case "max_tokens":
        // A tool_use block in a cut-off reply may have half its input: never run it.
        return finish("truncated");
      case "refusal":
        return finish("refused");
      case "tool_use":
        break; // handled below
      default:
        return finish("unexpected_stop");
    }

    const toolUses = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (toolUses.length === 0) {
      // "tool_use" with no tool_use block: there is nothing to answer, and an empty
      // user message would be rejected by the API.
      return finish("unexpected_stop");
    }

    // Limits are checked before the tools run: a tool result that no later model
    // call reads would be work (and maybe a write) for nothing.
    if (modelCalls >= request.limits.maxSteps) {
      return finish("step_limit");
    }
    if (usage.inputTokens + usage.outputTokens >= request.limits.tokenBudget) {
      return finish("token_budget");
    }

    // One by one, in the order the model asked. Not Promise.all: the trace then
    // shows the order things really happened, and two writes never race.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const result = await runToolCall(toolsByName, toolUse);
      await request.onStep({
        kind: "tool_call",
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        input: toolUse.input,
        output: result.output,
        isError: result.isError,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id, // pairs this result with its request
        content: result.output,
        is_error: result.isError,
      });
    }

    messages.push(
      // The whole reply, thinking blocks included: they must be sent back unchanged.
      { role: "assistant", content: message.content },
      // Every result in ONE user message. A missing result, or one with the wrong
      // tool_use_id, makes the API reject the next call.
      { role: "user", content: toolResults },
    );
  }
}

async function runToolCall(
  toolsByName: ReadonlyMap<string, AgentTool>,
  toolUse: Anthropic.ToolUseBlock,
): Promise<{ output: string; isError: boolean }> {
  const tool = toolsByName.get(toolUse.name);
  if (!tool) {
    return { output: `Unknown tool "${toolUse.name}".`, isError: true };
  }

  const parsed = tool.inputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error)
      .map((issue) => `${issue.path || "(input)"}: ${issue.message}`)
      .join("; ");
    return { output: `Invalid input: ${issues}`, isError: true };
  }

  try {
    const output = await tool.run(parsed.data);
    // `?? null`: JSON.stringify(undefined) is undefined, not a string.
    return { output: JSON.stringify(output ?? null), isError: false };
  } catch (error) {
    if (error instanceof ToolError) {
      return { output: error.message, isError: true };
    }
    throw error;
  }
}

// AgentTool → the tool definition the API expects.
function toToolDefinition(tool: AgentTool): Anthropic.Tool {
  // The same Zod → JSON Schema conversion the extraction uses for its output
  // format. It also moves limits the API cannot enforce (min, max…) into the
  // descriptions; Zod still checks them in runToolCall.
  const schema = zodOutputFormat(tool.inputSchema).schema;
  if (schema["type"] !== "object") {
    throw new Error(`Tool ${tool.name}: the input schema must be a z.object`);
  }
  return {
    name: tool.name,
    description: tool.description,
    input_schema: { ...schema, type: "object" },
    // The API guarantees the input matches the schema (Zod checks it again anyway).
    strict: true,
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function addUsage(total: AgentUsage, call: LlmCallUsage): void {
  total.inputTokens += call.inputTokens;
  total.outputTokens += call.outputTokens;
  // One unknown price makes the total unknown, never $0.
  total.costNanoUsd =
    total.costNanoUsd === null || call.costNanoUsd === null
      ? null
      : total.costNanoUsd + call.costNanoUsd;
}

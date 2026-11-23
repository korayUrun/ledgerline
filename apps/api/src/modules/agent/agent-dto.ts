import type Anthropic from "@anthropic-ai/sdk";
import type { AgentRun, Expense, ExpenseFlag } from "@ledgerline/db";
import type { AgentRunDto, AgentStepDto, ExpenseFlagDto } from "@ledgerline/schemas";
import { bigintToSafeNumber } from "../../common/bigint.js";
import type { AgentStep } from "./agent-loop.js";

export function toAgentRunDto(run: AgentRun): AgentRunDto {
  return {
    id: run.id,
    settlementId: run.settlementId,
    settlementVersion: run.settlementVersion,
    kind: run.kind,
    question: run.question,
    model: run.model,
    promptVersion: run.promptVersion,
    status: run.status,
    outcome: run.outcome,
    finalText: run.finalText,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    costNanoUsd: run.costNanoUsd === null ? null : bigintToSafeNumber(run.costNanoUsd),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

// The trace step → what the browser shows. Thinking blocks and tool_use blocks
// stay in the stored trace (F12) but are not sent: the text is the answer, and each
// tool call arrives as its own tool_call step right after.
export function toAgentStepDto(step: AgentStep): AgentStepDto {
  if (step.kind === "tool_call") {
    return {
      kind: "tool_call",
      toolName: step.toolName,
      input: step.input,
      output: step.output,
      isError: step.isError,
    };
  }
  return {
    kind: "model_call",
    text: step.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join(""),
    stopReason: step.stopReason,
    inputTokens: step.usage.inputTokens,
    outputTokens: step.usage.outputTokens,
  };
}

export function toExpenseFlagDto(flag: ExpenseFlag & { expense: Expense }): ExpenseFlagDto {
  return {
    id: flag.id,
    kind: flag.kind,
    reason: flag.reason,
    status: flag.status,
    agentRunId: flag.agentRunId,
    createdAt: flag.createdAt.toISOString(),
    resolvedAt: flag.resolvedAt?.toISOString() ?? null,
    expense: {
      id: flag.expense.id,
      category: flag.expense.category,
      description: flag.expense.description,
      amountCents: flag.expense.amountCents,
    },
  };
}

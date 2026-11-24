import { z } from "zod";

// The audit agent's vocabulary (F6, F12). Each enum is mirrored in schema.prisma;
// packages/db/src/enums.test.ts fails if the two lists drift apart.

// What started a run: the "Run audit" button, or a person's question in the chat.
// audit and question run on one settlement; workspace is the Assistant page, which
// answers about any show and belongs to no settlement.
export const AgentRunKindSchema = z.enum(["audit", "question", "workspace"]);
export type AgentRunKind = z.infer<typeof AgentRunKindSchema>;

// running → completed (the loop returned an outcome) or failed (it threw: the
// database went down, the API call failed after its retries…).
export const AgentRunStatusSchema = z.enum(["running", "completed", "failed"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

// How a completed run ended. Only "answered" has a final answer.
export const AgentOutcomeSchema = z.enum([
  "answered", // end_turn
  "step_limit", // still asking for tools after the last allowed model call
  "token_budget", // still asking for tools with the token budget used up
  "truncated", // max_tokens: the reply was cut off
  "refused", // the model declined
  "unexpected_stop", // a stop the loop does not handle (pause_turn, stop_sequence…)
]);
export type AgentOutcome = z.infer<typeof AgentOutcomeSchema>;

export const AgentStepKindSchema = z.enum(["model_call", "tool_call"]);
export type AgentStepKind = z.infer<typeof AgentStepKindSchema>;

// Why an expense was flagged. The first two are the rule breaks the eval plants
// (packages/evals scenario.ts); "other" is the agent's judgment, explained in the
// flag's reason (e.g. a receipt that looks like a duplicate).
export const ExpenseFlagKindSchema = z.enum(["category_not_allowed", "over_category_cap", "other"]);
export type ExpenseFlagKind = z.infer<typeof ExpenseFlagKindSchema>;

// open → accepted (the person agrees and acts on the expense) or dismissed.
export const ExpenseFlagStatusSchema = z.enum(["open", "accepted", "dismissed"]);
export type ExpenseFlagStatus = z.infer<typeof ExpenseFlagStatusSchema>;

// --- HTTP contract (apps/api ↔ web) ----------------------------------------------------
// Bodies are Zod (the API validates them); responses and stream events are plain
// types, like the rest of api.ts.

export const AskBodySchema = z.object({
  question: z.string().trim().min(1).max(2_000),
});
export type AskBody = z.infer<typeof AskBodySchema>;

// A person's decision on a flag. "open" is not a choice: a flag cannot be reopened.
export const ResolveFlagBodySchema = z.object({
  resolution: z.enum(["accepted", "dismissed"]),
});
export type ResolveFlagBody = z.infer<typeof ResolveFlagBodySchema>;

export type AgentRunDto = {
  id: string;
  settlementId: string | null; // null for a workspace run
  settlementVersion: number | null;
  kind: AgentRunKind;
  question: string;
  model: string;
  promptVersion: string;
  status: AgentRunStatus;
  outcome: AgentOutcome | null;
  finalText: string | null;
  inputTokens: number;
  outputTokens: number;
  costNanoUsd: number | null; // 1 USD = 1e9; null when some call had no known price
  startedAt: string;
  finishedAt: string | null;
};

// One step as the browser shows it. The same shape streams live (SSE) and comes
// back from the replay endpoint, so the chat panel renders both with one component.
export type AgentStepDto =
  | {
      kind: "model_call";
      text: string; // the reply's text blocks; "" when it only asked for tools
      stopReason: string | null;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      kind: "tool_call";
      toolName: string;
      input: unknown;
      output: string; // exactly what the model got back
      isError: boolean;
    };

export type AgentRunDetailDto = { run: AgentRunDto; steps: AgentStepDto[] };

// The events of POST /settlements/:id/ask and /audit, in order:
//   run_started, step × n, then run_finished or run_failed.
export type AgentEventDto =
  | { type: "run_started"; runId: string }
  | { type: "step"; step: AgentStepDto }
  | { type: "run_finished"; run: AgentRunDto }
  | { type: "run_failed"; runId: string; message: string };

export type ExpenseFlagDto = {
  id: string;
  kind: ExpenseFlagKind;
  reason: string;
  status: ExpenseFlagStatus;
  // Who opened it: exactly one is set. agentRunId = the audit agent, apiKeyId = an
  // API client such as the MCP server.
  agentRunId: string | null;
  apiKeyId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  expense: { id: string; category: string; description: string; amountCents: number };
};

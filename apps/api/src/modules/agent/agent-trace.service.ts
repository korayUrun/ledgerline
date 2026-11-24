import type Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  Prisma,
  type AgentRun,
  type AgentStep as AgentStepRow,
  type PrismaClient,
} from "@ledgerline/db";
import type { AgentRunKind } from "@ledgerline/schemas";
import { bigintToSafeNumber } from "../../common/bigint.js";
import { PRISMA } from "../../common/tokens.js";
import type { AgentRunResult, AgentStep } from "./agent-loop.js";

export type StartRunInput = {
  settlementId: string | null; // null for a workspace run (no single settlement)
  settlementVersion: number | null;
  kind: AgentRunKind;
  question: string;
  model: string;
  promptVersion: string;
  startedBy: string; // actor label, e.g. "user:<id>"
};

// Stores agent runs and their steps (F12), so any answer can be replayed step by
// step: what the model said, which tool it called with what input, what came back.
//
// The caller drives it around runAgent:
//   runId = startRun(…)
//   runAgent(…, onStep: (step) => recordStep(runId, position++, step))
//   finishRun(runId, result)   or, if runAgent threw,   failRun(runId, error)
@Injectable()
export class AgentTraceService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async startRun(input: StartRunInput): Promise<string> {
    const run = await this.prisma.agentRun.create({ data: input });
    return run.id;
  }

  async recordStep(runId: string, position: number, step: AgentStep): Promise<void> {
    if (step.kind === "tool_call") {
      await this.prisma.agentStep.create({
        data: {
          runId,
          position,
          kind: "tool_call",
          toolUseId: step.toolUseId,
          toolName: step.toolName,
          // The model's input is parsed JSON from the API, so it is valid JSON.
          toolInput: step.input as Prisma.InputJsonValue,
          toolOutput: step.output,
          isError: step.isError,
        },
      });
      return;
    }

    const { usage } = step;
    // The step and the run's running totals in one transaction: the totals can
    // never disagree with the steps, even if the process dies right after.
    await this.prisma.$transaction([
      this.prisma.agentStep.create({
        data: {
          runId,
          position,
          kind: "model_call",
          model: usage.model,
          stopReason: step.stopReason,
          // The reply's blocks came from the API as JSON, so they are JSON. The cast
          // only tells TypeScript so: the SDK types are interfaces, not JSON types.
          content: step.content as unknown as Prisma.InputJsonArray,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costNanoUsd: usage.costNanoUsd === null ? null : BigInt(usage.costNanoUsd),
          durationMs: usage.durationMs,
        },
      }),
      this.prisma.agentRun.update({
        where: { id: runId },
        data: {
          inputTokens: { increment: usage.inputTokens },
          outputTokens: { increment: usage.outputTokens },
          // An unknown price makes the total unknown. Once NULL, it stays NULL:
          // the increment runs as SQL "cost + x", and NULL + x is NULL.
          costNanoUsd: usage.costNanoUsd === null ? null : { increment: BigInt(usage.costNanoUsd) },
        },
      }),
    ]);
  }

  async finishRun(runId: string, result: AgentRunResult): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: "completed",
        outcome: result.outcome,
        finalText: result.finalText,
        finishedAt: new Date(),
      },
    });
  }

  async failRun(runId: string, error: unknown): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      },
    });
  }

  async getRun(runId: string): Promise<AgentRun> {
    const run = await this.prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException(`Agent run ${runId} not found`);
    }
    return run;
  }

  // Newest first: the chat panel shows the latest audit and questions on top.
  listRuns(settlementId: string): Promise<AgentRun[]> {
    return this.prisma.agentRun.findMany({
      where: { settlementId },
      orderBy: { startedAt: "desc" },
    });
  }

  // The Assistant page's recent conversations, newest first. Bounded: the page shows
  // a short history, not every run ever made.
  listWorkspaceRuns(limit: number): Promise<AgentRun[]> {
    return this.prisma.agentRun.findMany({
      where: { kind: "workspace" },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  // A run's steps in order, in the same shape runAgent produced them. Replaying a
  // run = reading these from the top.
  async readSteps(runId: string): Promise<AgentStep[]> {
    const rows = await this.prisma.agentStep.findMany({
      where: { runId },
      orderBy: { position: "asc" },
    });
    return rows.map(toAgentStep);
  }
}

function toAgentStep(row: AgentStepRow): AgentStep {
  if (row.kind === "tool_call") {
    return {
      kind: "tool_call",
      toolUseId: required(row, "toolUseId"),
      toolName: required(row, "toolName"),
      input: row.toolInput,
      output: required(row, "toolOutput"),
      isError: required(row, "isError"),
    };
  }
  if (!Array.isArray(row.content)) {
    throw new Error(`AgentStep ${row.id}: model_call without content blocks`);
  }
  return {
    kind: "model_call",
    // Written by recordStep from the API's reply (see the cast there).
    stopReason: row.stopReason as Anthropic.StopReason | null,
    content: row.content as unknown as Anthropic.ContentBlock[],
    usage: {
      model: required(row, "model"),
      inputTokens: required(row, "inputTokens"),
      outputTokens: required(row, "outputTokens"),
      costNanoUsd: row.costNanoUsd === null ? null : bigintToSafeNumber(row.costNanoUsd),
      durationMs: required(row, "durationMs"),
    },
  };
}

// The columns of the other step kind are nullable, so the database cannot promise
// that a tool_call row has its tool columns. recordStep always writes them; if one
// is missing anyway, fail loudly instead of replaying a half-empty step.
function required<K extends keyof AgentStepRow>(
  row: AgentStepRow,
  column: K,
): NonNullable<AgentStepRow[K]> {
  const value = row[column];
  if (value === null || value === undefined) {
    throw new Error(`AgentStep ${row.id}: ${row.kind} without ${String(column)}`);
  }
  return value;
}

import {
  AGENT_LIMITS,
  AGENT_SYSTEM_PROMPT,
  AUDIT_QUESTION,
  buildAuditTools,
  runAgent,
  type FlagExpense,
  type LlmClient,
} from "@ledgerline/api";
import type { LoadedCase } from "../dataset.js";
import { contextFromCase } from "./case-context.js";
import { scoreFlags, type FlagScore, type RaisedFlag } from "./score-flags.js";

// Runs the production audit (same loop, tools, prompt and limits as "Run audit")
// on each case and scores its flags against the planted violations. Flags go to
// a list in memory instead of the database. No files, no console: the script does
// the I/O.

export type AgentCaseResult = {
  id: string;
  dealType: string;
  outcome: string; // the loop's outcome, or "error"
  failure: string | null;
  flags: RaisedFlag[];
  score: FlagScore;
  modelCalls: number;
  toolCalls: number;
  tokens: { input: number; output: number };
  costNanoUsd: number | null;
  durationMs: number;
};

export type AgentEvalOptions = {
  model: string;
  llmFor: (loaded: LoadedCase) => LlmClient;
  concurrency: number;
  onCaseDone?: (result: AgentCaseResult) => void;
};

export async function runAgentEval(
  cases: LoadedCase[],
  options: AgentEvalOptions,
): Promise<AgentCaseResult[]> {
  const results: AgentCaseResult[] = new Array<AgentCaseResult>(cases.length);
  let next = 0;
  // The same small worker pool as the extraction eval (run-eval.ts).
  async function work(): Promise<void> {
    while (next < cases.length) {
      const index = next++;
      results[index] = await runCase(cases[index]!, options);
      options.onCaseDone?.(results[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, cases.length) }, work));
  return results;
}

async function runCase(loaded: LoadedCase, options: AgentEvalOptions): Promise<AgentCaseResult> {
  const { evalCase } = loaded;
  const startedAt = Date.now();
  const flags: RaisedFlag[] = [];
  // Like ExpenseFlagsService: an open flag of the same kind is not opened twice.
  const flagExpense: FlagExpense = (input) => {
    const existing = flags.findIndex(
      (flag) => flag.expenseId === input.expenseId && flag.kind === input.kind,
    );
    if (existing === -1) flags.push({ expenseId: input.expenseId, kind: input.kind });
    return Promise.resolve({
      flagId: `flag-${existing === -1 ? flags.length : existing + 1}`,
      created: existing === -1,
    });
  };
  let toolCalls = 0;
  const base = { id: evalCase.id, dealType: evalCase.dealType };
  try {
    const result = await runAgent(options.llmFor(loaded), {
      model: options.model,
      system: AGENT_SYSTEM_PROMPT,
      tools: buildAuditTools(contextFromCase(evalCase), flagExpense),
      question: AUDIT_QUESTION,
      limits: AGENT_LIMITS,
      onStep: (step) => {
        if (step.kind === "tool_call") toolCalls++;
        return Promise.resolve();
      },
    });
    return {
      ...base,
      outcome: result.outcome,
      failure: null,
      flags,
      score: scoreFlags(evalCase.plantedViolations, flags),
      modelCalls: result.modelCalls,
      toolCalls,
      tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
      costNanoUsd: result.usage.costNanoUsd,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    // A run that throws is a result to report, not a reason to stop the eval. Its
    // tokens are unknown, so its cost is too.
    return {
      ...base,
      outcome: "error",
      failure: error instanceof Error ? error.message : String(error),
      flags,
      score: scoreFlags(evalCase.plantedViolations, flags),
      modelCalls: 0,
      toolCalls,
      tokens: { input: 0, output: 0 },
      costNanoUsd: null,
      durationMs: Date.now() - startedAt,
    };
  }
}

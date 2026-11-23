import { formatNanoUsd } from "@ledgerline/api";
import { percent } from "../runner/report.js";
import type { AgentCaseResult } from "./run-agent-eval.js";
import { precisionRecall } from "./score-flags.js";

// The agent eval's numbers (summary, also saved as the JSON baseline) and the
// markdown page people read.

export type AgentRunInfo = {
  generatedAt: string;
  mode: "live" | "oracle";
  model: string;
  promptVersion: string;
};

export type AgentEvalSummary = AgentRunInfo & {
  cases: number;
  planted: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  rightKind: number;
  outcomes: Record<string, number>; // "answered": 24, "step_limit": 1…
  modelCalls: number;
  toolCalls: number;
  tokens: { input: number; output: number };
  costNanoUsd: number | null;
  averageDurationMs: number;
};

export function summarizeAgent(info: AgentRunInfo, results: AgentCaseResult[]): AgentEvalSummary {
  const counts = precisionRecall(results.map((result) => result.score));
  const outcomes: Record<string, number> = {};
  let costNanoUsd: number | null = 0;
  for (const result of results) {
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    costNanoUsd =
      costNanoUsd === null || result.costNanoUsd === null ? null : costNanoUsd + result.costNanoUsd;
  }
  const sum = (pick: (result: AgentCaseResult) => number) =>
    results.reduce((total, result) => total + pick(result), 0);
  return {
    ...info,
    cases: results.length,
    planted: counts.truePositives + counts.falseNegatives,
    ...counts,
    outcomes,
    modelCalls: sum((result) => result.modelCalls),
    toolCalls: sum((result) => result.toolCalls),
    tokens: { input: sum((r) => r.tokens.input), output: sum((r) => r.tokens.output) },
    costNanoUsd,
    averageDurationMs: results.length === 0 ? 0 : sum((r) => r.durationMs) / results.length,
  };
}

export function precisionText(summary: AgentEvalSummary): string {
  return percent(summary.truePositives, summary.truePositives + summary.falsePositives);
}

export function recallText(summary: AgentEvalSummary): string {
  return percent(summary.truePositives, summary.planted);
}

export function agentReportMarkdown(summary: AgentEvalSummary, results: AgentCaseResult[]): string {
  const cost = summary.costNanoUsd === null ? "unknown" : formatNanoUsd(summary.costNanoUsd);
  const lines = [
    `# Agent eval: expense flags`,
    "",
    `${summary.generatedAt} · ${summary.mode} · \`${summary.model}\` · prompt \`${summary.promptVersion}\``,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Precision (flagged expenses that are planted violations) | ${precisionText(summary)} (${summary.truePositives}/${summary.truePositives + summary.falsePositives}) |`,
    `| Recall (planted violations flagged) | ${recallText(summary)} (${summary.truePositives}/${summary.planted}) |`,
    `| Right kind (of the found) | ${percent(summary.rightKind, summary.truePositives)} (${summary.rightKind}/${summary.truePositives}) |`,
    `| Outcomes | ${Object.entries(summary.outcomes)
      .map(([outcome, count]) => `${outcome} ${count}`)
      .join(", ")} |`,
    `| Model calls / tool calls | ${summary.modelCalls} / ${summary.toolCalls} |`,
    `| Tokens in / out | ${summary.tokens.input.toLocaleString("en-US")} / ${summary.tokens.output.toLocaleString("en-US")} |`,
    `| Cost | ${cost} |`,
    `| Average time per case | ${(summary.averageDurationMs / 1000).toFixed(1)} s |`,
    "",
    "## Cases",
    "",
    "| Case | Deal | Outcome | Found | Missed | Wrong flags | Calls |",
    "|---|---|---|---|---|---|---|",
    ...results.map(
      (result) =>
        `| ${result.id} | ${result.dealType} | ${result.outcome}${result.failure ? ` (${result.failure})` : ""} | ${result.score.truePositives.join(", ") || "—"} | ${result.score.falseNegatives.join(", ") || "—"} | ${result.score.falsePositives.join(", ") || "—"} | ${result.modelCalls} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

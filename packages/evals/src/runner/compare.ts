import { formatNanoUsd } from "@ledgerline/api";
import { percent, type EvalSummary } from "./report.js";

// The CI gate (evals.yml, docs/SYSTEM.md §11): a run fails when field accuracy or
// payout exactness is below the committed baseline. Equal passes; better passes and
// is a hint to save a new baseline.

export type GateMetric = {
  name: string;
  baseline: { part: number; whole: number };
  current: { part: number; whole: number };
  passed: boolean;
};

export type GateResult = { passed: boolean; metrics: GateMetric[] };

export function compareWithBaseline(current: EvalSummary, baseline: EvalSummary): GateResult {
  const metrics = [
    metric(
      "Field accuracy",
      { part: baseline.fieldAccuracy.correct, whole: baseline.fieldAccuracy.total },
      { part: current.fieldAccuracy.correct, whole: current.fieldAccuracy.total },
    ),
    metric(
      "Payout exact to the cent",
      { part: baseline.payoutExactness.exact, whole: baseline.payoutExactness.total },
      { part: current.payoutExactness.exact, whole: current.payoutExactness.total },
    ),
  ];
  return { passed: metrics.every((m) => m.passed), metrics };
}

function metric(
  name: string,
  baseline: GateMetric["baseline"],
  current: GateMetric["current"],
): GateMetric {
  // current/whole >= baseline/whole, compared by cross-multiplying so no float
  // rounding can decide a gate. A run that scored nothing (whole 0) never passes.
  const passed =
    current.whole > 0 && current.part * baseline.whole >= baseline.part * current.whole;
  return { name, baseline, current, passed };
}

// The PR comment: the gate table, then what was run, so a reviewer can see at a
// glance whether the change made extraction worse.
export function gateMarkdown(gate: GateResult, current: EvalSummary, baseline: EvalSummary) {
  const rows = gate.metrics.map(
    (m) =>
      `| ${m.name} | ${percent(m.baseline.part, m.baseline.whole)} (${m.baseline.part}/${m.baseline.whole}) | ${percent(m.current.part, m.current.whole)} (${m.current.part}/${m.current.whole}) | ${m.passed ? "✅" : "❌ below baseline"} |`,
  );
  const cost = current.costNanoUsd === null ? "unknown" : formatNanoUsd(current.costNanoUsd);
  return [
    `## Extraction eval: ${gate.passed ? "passed" : "FAILED"}`,
    "",
    "| Metric | Baseline | This PR | |",
    "|---|---|---|---|",
    ...rows,
    "",
    `This PR: ${current.mode} run, model \`${current.model}\`, prompt \`${current.promptVersion}\`, ${current.cases} contracts, ${current.extractionFailures} failures, ${current.retries} retries, cost ${cost}.`,
    `Baseline: model \`${baseline.model}\`, prompt \`${baseline.promptVersion}\`, ${baseline.generatedAt.slice(0, 10)} (\`packages/evals/baselines/extraction.json\`).`,
    "",
  ].join("\n");
}

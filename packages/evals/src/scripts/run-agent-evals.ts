import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AGENT_PROMPT_VERSION, AnthropicLlmClient, formatNanoUsd } from "@ledgerline/api";
import {
  agentReportMarkdown,
  precisionText,
  recallText,
  summarizeAgent,
} from "../agent/agent-report.js";
import { agentOracleClient } from "../agent/oracle.js";
import { runAgentEval } from "../agent/run-agent-eval.js";
import { listCaseIds, loadCase } from "../dataset.js";

// pnpm evals:agent                         live audit of all 25 cases (needs ANTHROPIC_API_KEY)
// pnpm evals:agent --model claude-opus-5-5 another model, to compare (default: AGENT_MODEL)
// pnpm evals:agent --cases c01,c08         only these cases
// pnpm evals:agent --oracle                no API calls: checks the eval pipeline itself
// pnpm evals:agent --save-baseline         also overwrite the committed baseline
//
// Reports go to evals/reports/ (gitignored); the baseline is
// packages/evals/baselines/agent.{md,json}.

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const REPORTS_DIR = path.join(REPO_ROOT, "evals/reports");
const BASELINE_DIR = fileURLToPath(new URL("../../baselines", import.meta.url));

try {
  process.loadEnvFile(path.join(REPO_ROOT, ".env"));
} catch {
  // No .env file: rely on the environment.
}

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    oracle: { type: "boolean", default: false },
    model: { type: "string" },
    cases: { type: "string" },
    concurrency: { type: "string", default: "4" },
    "save-baseline": { type: "boolean", default: false },
  },
});

const mode = args.oracle ? "oracle" : "live";
const model = args.oracle
  ? "oracle"
  : (args.model ?? process.env["AGENT_MODEL"] ?? "claude-sonnet-5-5");
const apiKey = process.env["ANTHROPIC_API_KEY"] || null;
if (mode === "live" && apiKey === null) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env, or run with --oracle.");
  process.exit(1);
}
if (mode === "oracle" && args["save-baseline"]) {
  console.error("Refusing to save an oracle run as the baseline: it measures nothing.");
  process.exit(1);
}

const ids = args.cases ? args.cases.split(",") : await listCaseIds();
const cases = await Promise.all(ids.map((id) => loadCase(id)));
console.log(`Auditing ${cases.length} settlements (${mode}, ${model})…`);

// Same retries and timeout as the API.
const live =
  apiKey === null
    ? null
    : new AnthropicLlmClient({
        apiKey,
        timeoutMs: 120_000,
        maxRetries: 3,
        log: () => {}, // one line per call would drown the per-case lines
      });

const results = await runAgentEval(cases, {
  model,
  llmFor: ({ evalCase }) => (mode === "oracle" ? agentOracleClient(evalCase) : live!),
  concurrency: Number(args.concurrency),
  onCaseDone: (result) => {
    const { score } = result;
    console.log(
      `${result.id}  ${result.outcome}  found ${score.truePositives.length}  missed ${score.falseNegatives.length}  wrong ${score.falsePositives.length}  calls ${result.modelCalls}  ${(result.durationMs / 1000).toFixed(1)}s${result.failure ? `  FAILED: ${result.failure}` : ""}`,
    );
  },
});

const generatedAt = new Date().toISOString();
const summary = summarizeAgent(
  { generatedAt, mode, model, promptVersion: AGENT_PROMPT_VERSION },
  results,
);
const markdown = agentReportMarkdown(summary, results);
const stamp = generatedAt.replaceAll(":", "-").slice(0, 19);
await mkdir(REPORTS_DIR, { recursive: true });
const reportPath = path.join(REPORTS_DIR, `${stamp}-agent-${mode}.md`);
await writeFile(reportPath, markdown);
await writeFile(
  path.join(REPORTS_DIR, `${stamp}-agent-${mode}.json`),
  `${JSON.stringify({ summary, results }, null, 2)}\n`,
);
if (args["save-baseline"]) {
  await mkdir(BASELINE_DIR, { recursive: true });
  await writeFile(path.join(BASELINE_DIR, "agent.md"), markdown);
  await writeFile(path.join(BASELINE_DIR, "agent.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Baseline saved to ${BASELINE_DIR}`);
}

const cost = summary.costNanoUsd === null ? "unknown" : formatNanoUsd(summary.costNanoUsd);
console.log(`\nPrecision ${precisionText(summary)} · recall ${recallText(summary)} · cost ${cost}`);
console.log(`Report: ${path.relative(REPO_ROOT, reportPath)}`);

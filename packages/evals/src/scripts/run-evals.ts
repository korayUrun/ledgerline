import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AnthropicLlmClient, EXTRACTION_PROMPT_VERSION, formatNanoUsd } from "@ledgerline/api";
import { listCaseIds, loadCase } from "../dataset.js";
import { compareWithBaseline, gateMarkdown } from "../runner/compare.js";
import { oracleClient } from "../runner/oracle.js";
import { percent, summarize, toMarkdown, type EvalSummary } from "../runner/report.js";
import { runEval } from "../runner/run-eval.js";

// pnpm evals                       live run on all 25 contracts (needs ANTHROPIC_API_KEY)
// pnpm evals --cases c01,c08       only these cases
// pnpm evals --oracle              no API calls: checks the eval pipeline itself
// pnpm evals --save-baseline       also overwrite the committed baseline
// pnpm evals --compare-baseline    exit 1 if below the baseline (the CI gate, evals.yml)
//   --summary-file <path>          write the gate's markdown there (the PR comment)
//
// Reports go to evals/reports/ (gitignored). The baseline in
// packages/evals/baselines/ is committed: later runs are compared with it.

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const REPORTS_DIR = path.join(REPO_ROOT, "evals/reports");
const BASELINE_DIR = fileURLToPath(new URL("../../baselines", import.meta.url));

try {
  process.loadEnvFile(path.join(REPO_ROOT, ".env"));
} catch {
  // No .env file: rely on the environment.
}

const { values: args } = parseArgs({
  // pnpm hands a "--" separator through to the script; it is not an argument.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    oracle: { type: "boolean", default: false },
    cases: { type: "string" },
    concurrency: { type: "string", default: "4" },
    "save-baseline": { type: "boolean", default: false },
    "compare-baseline": { type: "boolean", default: false },
    "summary-file": { type: "string" },
  },
});

const mode = args.oracle ? "oracle" : "live";
const model = args.oracle ? "oracle" : (process.env["EXTRACTION_MODEL"] ?? "claude-opus-5-5");
const apiKey = process.env["ANTHROPIC_API_KEY"] || null;
if (mode === "live" && apiKey === null) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env, or run with --oracle.");
  process.exit(1);
}
if (args["compare-baseline"] && args["save-baseline"]) {
  // Saving first would compare the run with itself and always pass.
  console.error("Use --compare-baseline or --save-baseline, not both.");
  process.exit(1);
}
if (mode === "oracle" && args["save-baseline"]) {
  console.error(
    "Refusing to save an oracle run as the baseline: it measures nothing about the model.",
  );
  process.exit(1);
}

const ids = args.cases ? args.cases.split(",") : await listCaseIds();
const cases = await Promise.all(ids.map((id) => loadCase(id)));
console.log(`Running ${cases.length} contracts (${mode}, ${model})…`);

// One real client for the whole run: same retries and timeout as the worker.
const live =
  apiKey === null
    ? null
    : new AnthropicLlmClient({
        apiKey,
        timeoutMs: 120_000,
        maxRetries: 3,
        log: (line) => console.log(`  ${line}`),
      });

const results = await runEval(cases, {
  model,
  llmFor: ({ evalCase }) => (mode === "oracle" ? oracleClient(evalCase.terms) : live!),
  concurrency: Number(args.concurrency),
  onCaseDone: (result) => {
    const correct = result.fields.filter((f) => f.outcome === "correct").length;
    console.log(
      `${result.id}  fields ${correct}/${result.fields.length}  payout ${result.payout.exact ? "exact" : `NOT exact (${result.payout.reason})`}  ${(result.durationMs / 1000).toFixed(1)}s${result.failure ? `  FAILED: ${result.failure}` : ""}`,
    );
  },
});

const generatedAt = new Date().toISOString();
const summary = summarize(
  { generatedAt, mode, model, promptVersion: EXTRACTION_PROMPT_VERSION },
  results,
);
const markdown = toMarkdown(summary, results);
const stamp = generatedAt.replaceAll(":", "-").slice(0, 19);
await mkdir(REPORTS_DIR, { recursive: true });
const reportPath = path.join(REPORTS_DIR, `${stamp}-${mode}.md`);
await writeFile(reportPath, markdown);
await writeFile(
  path.join(REPORTS_DIR, `${stamp}-${mode}.json`),
  `${JSON.stringify({ summary, results }, null, 2)}\n`,
);
if (args["save-baseline"]) {
  await mkdir(BASELINE_DIR, { recursive: true });
  await writeFile(path.join(BASELINE_DIR, "extraction.md"), markdown);
  await writeFile(
    path.join(BASELINE_DIR, "extraction.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(`Baseline saved to ${BASELINE_DIR}`);
}

console.log(
  `\nField accuracy ${percent(summary.fieldAccuracy.correct, summary.fieldAccuracy.total)} · payout exactness ${percent(summary.payoutExactness.exact, summary.payoutExactness.total)} · failures ${summary.extractionFailures} · cost ${formatNanoUsd(summary.costNanoUsd)}`,
);
console.log(`Report: ${path.relative(REPO_ROOT, reportPath)}`);

if (args["compare-baseline"]) {
  // The committed baseline (saving a new one in the same run is refused above).
  const baseline = JSON.parse(
    await readFile(path.join(BASELINE_DIR, "extraction.json"), "utf8"),
  ) as EvalSummary;
  const gate = compareWithBaseline(summary, baseline);
  const comment = gateMarkdown(gate, summary, baseline);
  if (args["summary-file"]) {
    await writeFile(args["summary-file"], comment);
  }
  console.log(`\n${comment}`);
  if (!gate.passed) {
    process.exitCode = 1;
  }
}

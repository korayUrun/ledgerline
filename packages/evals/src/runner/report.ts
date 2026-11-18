import { formatCents } from "@ledgerline/schemas";
import { formatNanoUsd } from "@ledgerline/api";
import type { CaseResult } from "./run-eval.js";
import { FIELD_NAMES, type FieldOutcome } from "./score.js";

// Turns case results into the numbers that matter (summary) and a markdown page
// people read (toMarkdown). The summary is also saved as JSON: it is what a later
// run is compared against (the baseline).

export type RunInfo = {
  generatedAt: string; // ISO time
  mode: "live" | "oracle";
  model: string;
  promptVersion: string;
};

type Counts = Record<FieldOutcome, number>;

export type EvalSummary = RunInfo & {
  cases: number;
  fieldAccuracy: { correct: number; total: number };
  payoutExactness: { exact: number; total: number };
  perField: ({ field: string; total: number } & Counts)[];
  byTag: { tag: string; cases: number; payoutExact: number }[];
  extractionFailures: number;
  retries: number; // extra calls beyond the first, over all cases
  tokens: { input: number; output: number };
  costNanoUsd: number | null;
  averageDurationMs: number;
};

export function summarize(info: RunInfo, results: CaseResult[]): EvalSummary {
  const allFields = results.flatMap((result) => result.fields);
  const perField = FIELD_NAMES.map((field) => {
    const counts: Counts = { correct: 0, wrong: 0, missed: 0, invented: 0 };
    for (const score of allFields.filter((s) => s.field === field)) counts[score.outcome]++;
    return { field, total: results.length, ...counts };
  });
  const tags = [...new Set(results.flatMap((result) => result.tags))].sort();
  let costNanoUsd: number | null = 0;
  for (const result of results) {
    const cost = result.usage?.costNanoUsd;
    costNanoUsd =
      costNanoUsd === null || cost === null || cost === undefined ? null : costNanoUsd + cost;
  }
  return {
    ...info,
    cases: results.length,
    fieldAccuracy: {
      correct: allFields.filter((score) => score.outcome === "correct").length,
      total: allFields.length,
    },
    payoutExactness: {
      exact: results.filter((result) => result.payout.exact).length,
      total: results.length,
    },
    perField,
    byTag: tags.map((tag) => {
      const tagged = results.filter((result) => result.tags.includes(tag));
      return {
        tag,
        cases: tagged.length,
        payoutExact: tagged.filter((r) => r.payout.exact).length,
      };
    }),
    extractionFailures: results.filter((result) => result.failure !== null).length,
    retries: results.reduce((sum, result) => sum + Math.max(0, result.attempts - 1), 0),
    tokens: {
      input: results.reduce((sum, result) => sum + (result.usage?.inputTokens ?? 0), 0),
      output: results.reduce((sum, result) => sum + (result.usage?.outputTokens ?? 0), 0),
    },
    costNanoUsd,
    averageDurationMs:
      results.length === 0
        ? 0
        : Math.round(results.reduce((sum, r) => sum + r.durationMs, 0) / results.length),
  };
}

// 289 of 300 → "96.3%". A report number, not money; one decimal is enough.
export function percent(part: number, whole: number): string {
  if (whole === 0) return "n/a";
  const tenths = Math.round((part * 1000) / whole);
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

export function toMarkdown(summary: EvalSummary, results: CaseResult[]): string {
  const costPerCase =
    summary.costNanoUsd === null || summary.cases === 0
      ? null
      : Math.round(summary.costNanoUsd / summary.cases);
  const lines = [
    `# Extraction eval: ${summary.generatedAt.slice(0, 10)}`,
    "",
    `Mode **${summary.mode}** · model \`${summary.model}\` · prompt \`${summary.promptVersion}\` · ${summary.cases} contracts`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Field accuracy (all fields) | ${percent(summary.fieldAccuracy.correct, summary.fieldAccuracy.total)} (${summary.fieldAccuracy.correct}/${summary.fieldAccuracy.total}) |`,
    `| Payout exactness (to the cent) | ${percent(summary.payoutExactness.exact, summary.payoutExactness.total)} (${summary.payoutExactness.exact}/${summary.payoutExactness.total}) |`,
    `| Extraction failures | ${summary.extractionFailures} |`,
    `| Retries (extra calls) | ${summary.retries} |`,
    `| Tokens in / out | ${summary.tokens.input.toLocaleString("en-US")} / ${summary.tokens.output.toLocaleString("en-US")} |`,
    `| Cost total / per contract | ${formatNanoUsd(summary.costNanoUsd)} / ${formatNanoUsd(costPerCase)} |`,
    `| Average time per contract | ${(summary.averageDurationMs / 1000).toFixed(1)} s |`,
    "",
    "## Accuracy per field",
    "",
    "Missed = the contract states it, the extraction returned null. Invented = the extraction returned a value the contract does not have.",
    "",
    "| Field | Accuracy | Correct | Wrong | Missed | Invented |",
    "|---|---|---|---|---|---|",
    ...summary.perField.map(
      (f) =>
        `| \`${f.field}\` | ${percent(f.correct, f.total)} | ${f.correct} | ${f.wrong} | ${f.missed} | ${f.invented} |`,
    ),
    "",
    "## Payout exactness by hard feature",
    "",
    "| Tag | Cases | Payout exact |",
    "|---|---|---|",
    ...summary.byTag.map((t) => `| ${t.tag} | ${t.cases} | ${t.payoutExact}/${t.cases} |`),
    "",
    "## Cases with errors",
    "",
  ];
  const wrongCases = results.filter(
    (result) => !result.payout.exact || result.fields.some((f) => f.outcome !== "correct"),
  );
  if (wrongCases.length === 0) {
    lines.push("None: every field and every payout matched.");
  }
  for (const result of wrongCases) {
    const payout =
      result.payout.payoutCents === null ? "n/a" : formatCents(result.payout.payoutCents);
    lines.push(
      `### ${result.id} (${result.dealType}${result.tags.length ? `; ${result.tags.join(", ")}` : ""})`,
      "",
      `Payout ${payout}, expected ${formatCents(result.expectedPayoutCents)}${result.payout.reason ? ` (${result.payout.reason})` : ""}. Attempts: ${result.attempts}.${result.failure ? ` Failure: ${result.failure}` : ""}`,
      "",
    );
    const fieldErrors = result.fields.filter((f) => f.outcome !== "correct");
    if (fieldErrors.length > 0) {
      lines.push("| Field | Outcome | Expected | Extracted |", "|---|---|---|---|");
      for (const f of fieldErrors) {
        lines.push(`| \`${f.field}\` | ${f.outcome} | ${f.expected ?? "—"} | ${f.actual ?? "—"} |`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

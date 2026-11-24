import { describe, expect, it } from "vitest";
import { compareWithBaseline, gateMarkdown } from "./compare.js";
import type { EvalSummary } from "./report.js";

function summary(
  fields: [correct: number, total: number],
  payouts: [exact: number, total: number],
): EvalSummary {
  return {
    generatedAt: "2026-11-19T13:17:48.174Z",
    mode: "live",
    model: "claude-opus-5-5",
    promptVersion: "extract-v2",
    cases: payouts[1],
    fieldAccuracy: { correct: fields[0], total: fields[1] },
    payoutExactness: { exact: payouts[0], total: payouts[1] },
    perField: [],
    byTag: [],
    extractionFailures: 0,
    retries: 0,
    tokens: { input: 0, output: 0 },
    costNanoUsd: 1_048_164_000,
    averageDurationMs: 5_848,
  };
}

const BASELINE = summary([300, 300], [25, 25]);

describe("compareWithBaseline", () => {
  it("passes when the run matches the baseline", () => {
    expect(compareWithBaseline(summary([300, 300], [25, 25]), BASELINE).passed).toBe(true);
  });

  it("fails when one field is wrong, even if every payout is still exact", () => {
    const gate = compareWithBaseline(summary([299, 300], [25, 25]), BASELINE);
    expect(gate.passed).toBe(false);
    expect(gate.metrics.map((m) => m.passed)).toEqual([false, true]);
  });

  it("fails when one payout is off", () => {
    expect(compareWithBaseline(summary([300, 300], [24, 25]), BASELINE).passed).toBe(false);
  });

  it("compares rates, so a run on fewer cases is judged fairly", () => {
    const baseline = summary([270, 300], [20, 25]); // 90% and 80%
    expect(compareWithBaseline(summary([27, 30], [4, 5]), baseline).passed).toBe(true);
    expect(compareWithBaseline(summary([26, 30], [4, 5]), baseline).passed).toBe(false);
  });

  it("never passes a run that scored nothing", () => {
    expect(compareWithBaseline(summary([0, 0], [0, 0]), BASELINE).passed).toBe(false);
  });
});

describe("gateMarkdown", () => {
  it("shows both numbers and marks the metric below the baseline", () => {
    const current = summary([299, 300], [25, 25]);
    const text = gateMarkdown(compareWithBaseline(current, BASELINE), current, BASELINE);
    expect(text).toContain("## Extraction eval: FAILED");
    expect(text).toContain(
      "| Field accuracy | 100.0% (300/300) | 99.7% (299/300) | ❌ below baseline |",
    );
    expect(text).toContain("| Payout exact to the cent | 100.0% (25/25) | 100.0% (25/25) | ✅ |");
  });
});

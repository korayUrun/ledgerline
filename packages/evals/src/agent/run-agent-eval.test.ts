import { describe, expect, it } from "vitest";
import { listCaseIds, loadCase } from "../dataset.js";
import { summarizeAgent } from "./agent-report.js";
import { agentOracleClient } from "./oracle.js";
import { runAgentEval } from "./run-agent-eval.js";

describe("runAgentEval with the oracle", () => {
  it("scores 100% precision and recall on the whole dataset", async () => {
    const cases = await Promise.all((await listCaseIds()).map((id) => loadCase(id)));

    const results = await runAgentEval(cases, {
      model: "oracle",
      llmFor: ({ evalCase }) => agentOracleClient(evalCase),
      concurrency: 4,
    });
    const summary = summarizeAgent(
      { generatedAt: "", mode: "oracle", model: "oracle", promptVersion: "test" },
      results,
    );

    // If this fails, the bug is in the tools, the dataset or the scoring, not the model.
    expect(results.every((result) => result.outcome === "answered")).toBe(true);
    expect(summary.planted).toBeGreaterThan(0);
    expect(summary).toMatchObject({
      truePositives: summary.planted,
      falsePositives: 0,
      falseNegatives: 0,
      rightKind: summary.planted,
    });
  });
});

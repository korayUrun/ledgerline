import { describe, expect, it } from "vitest";
import { listCaseIds, loadCase } from "../dataset.js";
import { oracleClient } from "./oracle.js";
import { summarize, toMarkdown } from "./report.js";
import { runEval } from "./run-eval.js";

describe("runEval with the oracle (a fake Claude that answers with the ground truth)", () => {
  // If this fails, the eval pipeline itself is broken (scoring, text ↔ cents
  // conversion, dataset), and no number it reports about the model can be trusted.
  it("scores 100% field accuracy and 100% payout exactness on all 25 cases", async () => {
    const cases = await Promise.all((await listCaseIds()).map((id) => loadCase(id)));
    const results = await runEval(cases, {
      model: "oracle",
      llmFor: ({ evalCase }) => oracleClient(evalCase.terms),
      concurrency: 4,
    });

    const summary = summarize(
      { generatedAt: "2026-11-19T00:00:00Z", mode: "oracle", model: "oracle", promptVersion: "x" },
      results,
    );
    expect(summary.cases).toBe(25);
    expect(summary.fieldAccuracy.correct).toBe(summary.fieldAccuracy.total);
    expect(summary.payoutExactness).toEqual({ exact: 25, total: 25 });
    expect(summary.extractionFailures).toBe(0);
    expect(toMarkdown(summary, results)).toContain("None: every field and every payout matched.");
  });
});

describe("toMarkdown", () => {
  it("lists a case with a wrong field and an inexact payout, with both values", async () => {
    const loaded = await loadCase("c03");
    // An extraction that took the deposit for the guarantee.
    const misread = structuredClone(loaded.evalCase.terms);
    if (misread.deal.type !== "versus") throw new Error("c03 is expected to be a versus deal");
    misread.deal.guaranteeCents = 275_000;
    const results = await runEval([loaded], {
      model: "oracle",
      llmFor: () => oracleClient(misread),
      concurrency: 1,
    });

    const markdown = toMarkdown(
      summarize(
        {
          generatedAt: "2026-11-19T00:00:00Z",
          mode: "oracle",
          model: "oracle",
          promptVersion: "x",
        },
        results,
      ),
      results,
    );
    expect(markdown).toContain("### c03");
    expect(markdown).toContain("| `deal.guaranteeCents` | wrong | 550000 | 275000 |");
  });
});

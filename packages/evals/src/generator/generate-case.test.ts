import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ContractTermsSchema,
  formatBps,
  formatCents,
  SettlementInputSchema,
} from "@ledgerline/schemas";
import { computeSettlement } from "@ledgerline/settlement-engine";
import { beforeAll, describe, expect, it } from "vitest";
import { DATASET_DIR, listCaseIds, loadCase } from "../dataset.js";
import { DATASET_SIZE, generateCase, type GeneratedCase } from "./generate-case.js";

let cases: GeneratedCase[];

beforeAll(async () => {
  cases = await Promise.all(
    Array.from({ length: DATASET_SIZE }, (_, index) => generateCase(index)),
  );
});

// "$12,500.00" → "$12,500" for whole dollars: every money style the contract uses
// contains this text (see wording.ts).
function moneyFigure(cents: number): string {
  const text = formatCents(cents);
  return cents % 100 === 0 ? text.slice(0, -3) : text;
}

describe("generateCase", () => {
  it("is deterministic: the same index gives the same case and byte-identical PDF", async () => {
    const again = await generateCase(6);
    expect(again.evalCase).toEqual(cases[6]!.evalCase);
    expect(again.text).toBe(cases[6]!.text);
    expect(again.pdf.equals(cases[6]!.pdf)).toBe(true);
  });

  it("produces valid terms and inputs, and the expected payout is the engine's", () => {
    for (const { evalCase } of cases) {
      expect(() => ContractTermsSchema.parse(evalCase.terms)).not.toThrow();
      const input = SettlementInputSchema.parse(evalCase);
      expect(computeSettlement(input).payoutCents).toBe(evalCase.expectedPayoutCents);
    }
  });

  it("writes every ground-truth value into the contract text", () => {
    for (const { evalCase, text } of cases) {
      const { deal, expensePolicy, bonus } = evalCase.terms;
      const expected: string[] = [];
      if ("guaranteeCents" in deal) expected.push(moneyFigure(deal.guaranteeCents));
      if ("artistShareBps" in deal) expected.push(formatBps(deal.artistShareBps));
      if (deal.type === "guarantee_plus") expected.push(formatBps(deal.promoterProfitBps));
      for (const cap of expensePolicy.categoryCaps) expected.push(moneyFigure(cap.capCents));
      if (expensePolicy.totalCapCents !== null) {
        expected.push(moneyFigure(expensePolicy.totalCapCents));
      }
      for (const tier of bonus?.tiers ?? []) {
        expected.push(tier.minTicketsSold.toLocaleString("en-US"), moneyFigure(tier.bonusCents));
      }
      for (const value of expected) {
        expect(text, `${evalCase.id} should state ${value}`).toContain(value);
      }
    }
  });

  it("points every clauseRef at the section or sub-clause that holds the clause", () => {
    for (const { evalCase, text } of cases) {
      const { deal, expensePolicy, bonus } = evalCase.terms;
      const refs = [deal.clauseRef, expensePolicy.clauseRef, ...(bonus ? [bonus.clauseRef] : [])];
      for (const ref of refs) {
        const number = ref.replace("§", "");
        // "§4" is a heading line "4. Compensation"; "§4.2" a paragraph "4.2 …".
        const marker = number.includes(".") ? `\n${number} ` : `\n${number}. `;
        expect(text, `${evalCase.id} ${ref}`).toContain(marker);
      }
    }
  });

  it("covers every deal type, both bonus modes and the hard cases", () => {
    const all = cases.map((c) => c.evalCase);
    const dealTypes = new Set(all.map((c) => c.dealType));
    expect(dealTypes).toEqual(new Set(["flat", "percentage", "versus", "guarantee_plus"]));
    expect(all.some((c) => c.terms.bonus === null)).toBe(true);
    expect(all.some((c) => c.terms.bonus?.mode === "cumulative")).toBe(true);
    expect(all.some((c) => c.terms.bonus?.mode === "highest_only")).toBe(true);
    const tags = all.flatMap((c) => c.tags);
    expect(tags.filter((tag) => tag === "prompt_injection")).toHaveLength(2);
    for (const tag of [
      "deposit_distractor",
      "merch_percent_distractor",
      "no_total_cap",
      "sub_clauses",
      "money_in_words",
      "cents_in_guarantee",
    ]) {
      expect(tags, tag).toContain(tag);
    }
    // Every versus / guarantee-plus case plants at least one violation for Phase 4.
    for (const c of all.filter((c) => c.dealType === "versus" || c.dealType === "guarantee_plus")) {
      expect(c.plantedViolations.length, c.id).toBeGreaterThan(0);
    }
  });
});

describe("committed dataset", () => {
  // If this fails, the generator changed: run `pnpm --filter @ledgerline/evals
  // generate` and commit the new dataset (and expect eval numbers to move).
  it("matches what the generator produces today", async () => {
    expect(await listCaseIds()).toEqual(cases.map((c) => c.evalCase.id));
    for (const generated of cases) {
      const committed = await loadCase(generated.evalCase.id);
      expect(committed.evalCase).toEqual(generated.evalCase);
      const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
      expect(sha(committed.pdf), generated.evalCase.id).toBe(sha(generated.pdf));
      const committedText = await readFile(
        path.join(DATASET_DIR, generated.evalCase.id, "contract.txt"),
        "utf8",
      );
      expect(committedText).toBe(generated.text);
    }
  });
});

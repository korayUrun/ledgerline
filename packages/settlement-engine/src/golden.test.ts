import { SettlementInputSchema } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import flatWeakNightExpected from "../fixtures/flat-weak-night.expected.json" with { type: "json" };
import flatWeakNightInput from "../fixtures/flat-weak-night.input.json" with { type: "json" };
import guaranteePlusStrongNightExpected from "../fixtures/guarantee-plus-strong-night-highest-only-bonus.expected.json" with { type: "json" };
import guaranteePlusStrongNightInput from "../fixtures/guarantee-plus-strong-night-highest-only-bonus.input.json" with { type: "json" };
import guaranteePlusWeakNightExpected from "../fixtures/guarantee-plus-weak-night.expected.json" with { type: "json" };
import guaranteePlusWeakNightInput from "../fixtures/guarantee-plus-weak-night.input.json" with { type: "json" };
import percentageStrongNightExpected from "../fixtures/percentage-strong-night.expected.json" with { type: "json" };
import percentageStrongNightInput from "../fixtures/percentage-strong-night.input.json" with { type: "json" };
import versusStrongNightExpected from "../fixtures/versus-strong-night-cumulative-bonus.expected.json" with { type: "json" };
import versusStrongNightInput from "../fixtures/versus-strong-night-cumulative-bonus.input.json" with { type: "json" };
import versusWeakNightExpected from "../fixtures/versus-weak-night.expected.json" with { type: "json" };
import versusWeakNightInput from "../fixtures/versus-weak-night.input.json" with { type: "json" };
import { computeSettlement } from "./compute-settlement.js";

// Golden files: a full input and the full expected result, every line included.
// The expected files were checked by hand against docs/domain.md once. From now
// on any change to a number, a label, a clauseRef or the line order fails here
// and shows up in the diff of the PR that caused it.
//
// To add a case: write fixtures/<name>.input.json, write the expected result by
// hand (or generate it and check every number), then add it to the list below.
const GOLDEN_CASES = [
  { name: "flat-weak-night", input: flatWeakNightInput, expected: flatWeakNightExpected },
  {
    name: "percentage-strong-night",
    input: percentageStrongNightInput,
    expected: percentageStrongNightExpected,
  },
  {
    name: "versus-strong-night-cumulative-bonus",
    input: versusStrongNightInput,
    expected: versusStrongNightExpected,
  },
  { name: "versus-weak-night", input: versusWeakNightInput, expected: versusWeakNightExpected },
  {
    name: "guarantee-plus-strong-night-highest-only-bonus",
    input: guaranteePlusStrongNightInput,
    expected: guaranteePlusStrongNightExpected,
  },
  {
    name: "guarantee-plus-weak-night",
    input: guaranteePlusWeakNightInput,
    expected: guaranteePlusWeakNightExpected,
  },
];

describe("golden files", () => {
  it.each(GOLDEN_CASES)("$name", ({ input, expected }) => {
    // JSON has no types, so the schema turns it into a SettlementInput first.
    expect(computeSettlement(SettlementInputSchema.parse(input))).toEqual(expected);
  });
});

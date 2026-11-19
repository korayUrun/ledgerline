import { describe, expect, it } from "vitest";
import { OUTPUT_FORMAT } from "./extract-contract.js";

// The API compiles the output schema into a grammar before the model runs, and it
// refuses schemas with too many union-typed fields ("X or null"): with 21 it
// answered 400 "too many parameters with union types", and the first version of
// this schema (24) gave 400 "compiled grammar is too large". Found by the first
// live eval run; the unit tests with a fake client could not see it.
//
// This counts the unions without calling the API, so the schema cannot quietly
// grow back past the limit.
const MAX_UNION_FIELDS = 16;

function countUnions(node: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce((sum: number, item) => sum + countUnions(item), 0);
  }
  if (node === null || typeof node !== "object") {
    return 0;
  }
  const record = node as Record<string, unknown>;
  const isUnion = "anyOf" in record || Array.isArray(record["type"]);
  return (
    (isUnion ? 1 : 0) +
    Object.values(record).reduce((sum: number, value) => sum + countUnions(value), 0)
  );
}

describe("extraction output format", () => {
  it(`has at most ${MAX_UNION_FIELDS} union-typed fields`, () => {
    expect(countUnions(OUTPUT_FORMAT.schema)).toBeLessThanOrEqual(MAX_UNION_FIELDS);
  });
});

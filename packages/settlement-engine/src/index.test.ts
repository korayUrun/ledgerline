import { describe, expect, it } from "vitest";
import * as engine from "./index.js";

// Smoke test so `pnpm test` runs real code from day one.
// Phase 1 replaces it with the hand-calculated examples from docs/domain.md.
describe("settlement-engine package", () => {
  it("loads as an ES module", () => {
    expect(engine).toBeTypeOf("object");
  });
});

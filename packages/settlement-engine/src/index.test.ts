import { describe, expect, it } from "vitest";
import { computeSettlement, ENGINE_VERSION } from "./index.js";

describe("public API", () => {
  it("exports the engine and a semver ENGINE_VERSION", () => {
    expect(typeof computeSettlement).toBe("function");
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

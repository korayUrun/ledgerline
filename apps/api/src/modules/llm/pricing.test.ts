import { describe, expect, it } from "vitest";
import { costNanoUsd, formatNanoUsd } from "./pricing.js";

describe("costNanoUsd", () => {
  it("prices input and output tokens with integer math", () => {
    // Opus 5.5: $4 / $20 per million tokens = 4,000 / 20,000 nano-dollars per token.
    expect(costNanoUsd("claude-opus-5-5", { inputTokens: 6_000, outputTokens: 1_500 })).toBe(
      6_000 * 4_000 + 1_500 * 20_000,
    );
    expect(costNanoUsd("claude-haiku-5-5", { inputTokens: 1, outputTokens: 1 })).toBe(600);
  });

  it("returns null for a model without a known price instead of guessing", () => {
    expect(costNanoUsd("claude-unknown-9", { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});

describe("formatNanoUsd", () => {
  it.each([
    [54_000_000, "$0.0540"],
    [1_234_567_890, "$1.2346"],
    [49, "$0.0000"],
    [50_000, "$0.0001"],
    [null, "unknown"],
  ])("%s → %s", (nano, text) => {
    expect(formatNanoUsd(nano)).toBe(text);
  });
});

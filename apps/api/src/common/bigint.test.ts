import { describe, expect, it } from "vitest";
import { bigintToSafeNumber } from "./bigint.js";

describe("bigintToSafeNumber", () => {
  it("converts values in the safe range exactly", () => {
    expect(bigintToSafeNumber(0n)).toBe(0);
    expect(bigintToSafeNumber(3_000_000_000n)).toBe(3_000_000_000);
    expect(bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("throws instead of rounding a value that a number cannot hold exactly", () => {
    expect(() => bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
    expect(() => bigintToSafeNumber(BigInt(Number.MIN_SAFE_INTEGER) - 1n)).toThrow(RangeError);
  });
});

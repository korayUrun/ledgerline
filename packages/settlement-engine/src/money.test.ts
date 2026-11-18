import { describe, expect, it } from "vitest";
import { applyBps, roundHalfUp } from "./money.js";

describe("roundHalfUp", () => {
  it.each([
    [0, 4, 0],
    [8, 4, 2], // exact
    [9, 4, 2], // remainder 1 of 4: below half → down
    [10, 4, 3], // remainder 2 of 4: exactly half → up
    [11, 4, 3], // remainder 3 of 4: above half → up
    [7, 2, 4],
  ])("%i / %i = %i", (numerator, denominator, expected) => {
    expect(roundHalfUp(numerator, denominator)).toBe(expected);
  });

  it.each([
    ["a negative numerator", -1, 4],
    ["a fractional numerator", 1.5, 4],
    ["an unsafe numerator", Number.MAX_SAFE_INTEGER + 1, 4],
    ["a zero denominator", 1, 0],
    ["a negative denominator", 1, -4],
  ])("throws on %s", (_name, numerator, denominator) => {
    expect(() => roundHalfUp(numerator, denominator)).toThrow(RangeError);
  });
});

describe("applyBps (docs/domain.md §9)", () => {
  it("example 1: 85% of 1,234,567 = 1,049,382 (remainder 9,500 rounds up)", () => {
    expect(applyBps(1_234_567, 8500)).toBe(1_049_382);
  });

  it("example 2: 85% of 1,234,510 = 1,049,334 (remainder exactly 5,000 rounds up)", () => {
    expect(applyBps(1_234_510, 8500)).toBe(1_049_334);
  });

  it("self-check 3: 70% of 1,234,565 = 864,196", () => {
    expect(applyBps(1_234_565, 7000)).toBe(864_196);
  });

  it("rounds down when the remainder is 4,999 and up when it is 5,000", () => {
    // 1 × 4999 = 4999 → 0.4999 cents; 1 × 5000 = 5000 → 0.5 cents
    expect(applyBps(1, 4999)).toBe(0);
    expect(applyBps(1, 5000)).toBe(1);
  });

  it("example 3: rounding once on the total differs from rounding each row", () => {
    const roundedPerRow = applyBps(1_234_510, 8500) + applyBps(765_510, 8500);
    const roundedOnce = applyBps(1_234_510 + 765_510, 8500);
    expect(roundedPerRow).toBe(1_700_018);
    expect(roundedOnce).toBe(1_700_017);
  });

  it("keeps 100% and 0% exact", () => {
    expect(applyBps(1_928_000, 10_000)).toBe(1_928_000);
    expect(applyBps(1_928_000, 0)).toBe(0);
  });

  it.each([
    ["a negative amount", -100, 8500],
    ["a fractional amount", 100.5, 8500],
    ["a negative bps", 100, -1],
    ["a fractional bps", 100, 85.5],
    ["bps above 100%", 100, 10_001],
    ["a product beyond the safe-integer range", Number.MAX_SAFE_INTEGER, 2],
  ])("throws on %s", (_name, amountCents, bps) => {
    expect(() => applyBps(amountCents, bps)).toThrow(RangeError);
  });
});

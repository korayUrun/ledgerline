import { describe, expect, it } from "vitest";
import { createRng } from "./random.js";
import { numberToWords, writeMoney, writePercent } from "./wording.js";

describe("numberToWords", () => {
  it.each([
    [0, "zero"],
    [15, "fifteen"],
    [85, "eighty-five"],
    [100, "one hundred"],
    [12_500, "twelve thousand five hundred"],
    [1_000_001, "one million one"],
    [40_000, "forty thousand"],
  ])("%i → %s", (value, words) => {
    expect(numberToWords(value)).toBe(words);
  });

  it("rejects decimals and values it cannot spell", () => {
    expect(() => numberToWords(1.5)).toThrow();
    expect(() => numberToWords(-1)).toThrow();
    expect(() => numberToWords(1_000_000_000)).toThrow();
  });
});

describe("writeMoney / writePercent", () => {
  it("always keeps the figure in digits, whatever the style", () => {
    const rng = createRng(42);
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(writeMoney(1_250_000, rng)).toContain("$12,500");
      expect(writeMoney(751_237, rng)).toContain("$7,512.37");
      expect(writePercent(8500, rng)).toContain("85%");
      expect(writePercent(1250, rng)).toBe("12.5%");
    }
  });

  it("spells whole-dollar amounts in words in one of its styles", () => {
    const rng = createRng(7);
    const styles = new Set(Array.from({ length: 50 }, () => writeMoney(1_250_000, rng)));
    expect(styles).toContain("Twelve Thousand Five Hundred Dollars (US $12,500.00)");
  });
});

describe("createRng", () => {
  it("repeats the same sequence for the same seed and stays in bounds", () => {
    const a = createRng(1);
    const b = createRng(1);
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = a.int(3, 7);
      expect(value).toBe(b.int(3, 7));
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });
});

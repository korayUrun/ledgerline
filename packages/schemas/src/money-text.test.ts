import { describe, expect, it } from "vitest";
import { MAX_CENTS } from "./money.js";
import { formatBps, formatCents, parseDollarsToCents, parsePercentToBps } from "./money-text.js";

describe("parseDollarsToCents", () => {
  it.each([
    ["0", 0],
    ["35", 3_500],
    ["35.5", 3_550],
    ["35.05", 3_505],
    ["0.29", 29], // parseFloat("0.29") * 100 = 28.999999999999996
    ["1,250.00", 125_000],
    ["$1,250.50", 125_050],
    ["  12.30  ", 1_230],
    ["10,000,000", MAX_CENTS],
  ])("%s → %i cents", (text, cents) => {
    expect(parseDollarsToCents(text)).toBe(cents);
  });

  it.each([
    "",
    "abc",
    "-5",
    "1.234", // more than two decimals
    "1,2,3", // misplaced thousands separator
    "12,50", // comma as decimal separator
    "1e3",
    "10,000,000.01", // above MAX_CENTS
    "99999999999999999999",
  ])("rejects %j", (text) => {
    expect(parseDollarsToCents(text)).toBeNull();
  });
});

describe("parsePercentToBps", () => {
  it.each([
    ["85", 8_500],
    ["85%", 8_500],
    ["12.5", 1_250],
    ["12.05", 1_205],
    ["0", 0],
    ["100", 10_000],
  ])("%s → %i bps", (text, bps) => {
    expect(parsePercentToBps(text)).toBe(bps);
  });

  it.each(["", "100.01", "150", "-1", "1.234", "abc"])("rejects %j", (text) => {
    expect(parsePercentToBps(text)).toBeNull();
  });
});

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [3_550, "$35.50"],
    [123_456, "$1,234.56"],
    [MAX_CENTS, "$10,000,000.00"],
    [-2_500, "-$25.00"],
  ])("%i → %s", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
});

describe("formatBps", () => {
  it.each([
    [8_500, "85%"],
    [1_250, "12.5%"],
    [1_205, "12.05%"],
    [0, "0%"],
  ])("%i → %s", (bps, text) => {
    expect(formatBps(bps)).toBe(text);
  });
});

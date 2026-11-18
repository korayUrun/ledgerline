import { formatBps, formatCents } from "@ledgerline/schemas";
import type { Rng } from "./random.js";

// How amounts are written in the contract text. Real contracts mix styles, so the
// generator does too: the extractor must read "$12,500.00", "US $12,500" and
// "Twelve Thousand Five Hundred Dollars (US $12,500.00)" as the same amount.
// Every style keeps the figure in digits, so the amount can always be quoted.

export function writeMoney(cents: number, rng: Rng): string {
  const figure = formatCents(cents); // "$12,500.00"
  const wholeDollars = cents % 100 === 0;
  const styles = [figure, `US ${figure}`];
  if (wholeDollars) {
    styles.push(`${figure.slice(0, -3)}`); // "$12,500"
    styles.push(`${capitalizeWords(numberToWords(cents / 100))} Dollars (US ${figure})`);
  }
  return rng.pick(styles);
}

// 8500 → "85%", "eighty-five percent (85%)" or "85 percent (85%)".
export function writePercent(bps: number, rng: Rng): string {
  const figure = formatBps(bps); // "85%" or "12.5%"
  const styles = [figure];
  if (bps % 100 === 0) {
    styles.push(`${numberToWords(bps / 100)} percent (${figure})`);
  }
  return rng.pick(styles);
}

export function writeCount(count: number): string {
  return count.toLocaleString("en-US");
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

// 12500 → "twelve thousand five hundred". Whole numbers below one billion.
export function numberToWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value >= 1_000_000_000) {
    throw new Error(`numberToWords: unsupported value ${value}`);
  }
  if (value < 20) {
    return ONES[value]!;
  }
  if (value < 100) {
    const rest = value % 10;
    return TENS[Math.floor(value / 10)]! + (rest ? `-${ONES[rest]}` : "");
  }
  if (value < 1000) {
    const rest = value % 100;
    return `${ONES[Math.floor(value / 100)]} hundred${rest ? ` ${numberToWords(rest)}` : ""}`;
  }
  for (const [size, name] of [
    [1_000_000, "million"],
    [1000, "thousand"],
  ] as const) {
    if (value >= size) {
      const rest = value % size;
      return `${numberToWords(Math.floor(value / size))} ${name}${rest ? ` ${numberToWords(rest)}` : ""}`;
    }
  }
  throw new Error("unreachable");
}

function capitalizeWords(text: string): string {
  return text.replace(/(^|[\s-])([a-z])/g, (_match, before: string, letter: string) => {
    return before + letter.toUpperCase();
  });
}

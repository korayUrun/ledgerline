import { MAX_BPS, MAX_CENTS } from "./money.js";

// Converting between money and the text people type or read. Every function works
// on the digits as strings and integers, never through a float: parseFloat("0.29")
// * 100 is 28.999999999999996, which would silently lose a cent.

// "1250", "1250.5", "1,250.50", "$1,250.50". Thousands separators must be in the
// right places ("1,2,3" is rejected), and at most two decimal places are allowed.
const DOLLARS_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

// Returns null for anything that is not a valid amount, so the caller decides how
// to report the error (a 400 in the API, a form message in the web app).
export function parseDollarsToCents(text: string): number | null {
  const withoutSign = text.trim().replace(/^\$/, "");
  const match = DOLLARS_PATTERN.exec(withoutSign);
  if (!match) {
    return null;
  }
  const wholeDollars = Number(match[1]!.replaceAll(",", ""));
  // "5" → 50 cents, "05" → 5 cents: pad the decimals to two digits first.
  const centsPart = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = wholeDollars * 100 + centsPart;
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) {
    return null;
  }
  return cents;
}

// "85" → 8500 bps, "12.5" → 1250 bps. At most two decimals, because 1 bps = 0.01%.
const PERCENT_PATTERN = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

export function parsePercentToBps(text: string): number | null {
  const match = PERCENT_PATTERN.exec(text.trim().replace(/%$/, ""));
  if (!match) {
    return null;
  }
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps <= MAX_BPS ? bps : null;
}

// 123456 → "$1,234.56". Splits into whole dollars and leftover cents with integer
// math, then groups the thousands of the (integer) dollar part.
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absoluteCents = Math.abs(cents);
  const leftoverCents = absoluteCents % 100;
  const wholeDollars = (absoluteCents - leftoverCents) / 100;
  return `${sign}$${wholeDollars.toLocaleString("en-US")}.${String(leftoverCents).padStart(2, "0")}`;
}

// 8500 → "85%", 1250 → "12.5%", 1205 → "12.05%".
export function formatBps(bps: number): string {
  const leftover = bps % 100;
  const whole = (bps - leftover) / 100;
  if (leftover === 0) {
    return `${whole}%`;
  }
  const decimals = String(leftover).padStart(2, "0").replace(/0$/, "");
  return `${whole}.${decimals}%`;
}

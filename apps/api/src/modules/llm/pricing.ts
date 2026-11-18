import { roundHalfUp } from "@ledgerline/settlement-engine";

// What a Claude call costs, for the logs and the eval report. Kept in integer
// nano-dollars (1 USD = 1e9) for the same reason money is kept in cents: no
// floating-point drift when many calls are added up. $4 per million tokens is
// exactly 4,000 nano-dollars per token, so every price below is a whole number.
//
// Prices from the Claude API price list (input / output per million tokens).
// Cache tokens are not priced: we send no cache_control, so they stay 0.
const NANO_USD_PER_TOKEN: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4_000, output: 20_000 }, // $4 / $20
  "claude-sonnet-5-5": { input: 2_000, output: 10_000 }, // $2 / $10
  "claude-haiku-5-5": { input: 100, output: 500 }, // $0.10 / $0.50
};

export type TokenCounts = { inputTokens: number; outputTokens: number };

// null when the model is not in the table: an unknown cost is reported as unknown,
// never as $0.
export function costNanoUsd(model: string, tokens: TokenCounts): number | null {
  const price = NANO_USD_PER_TOKEN[model];
  if (!price) {
    return null;
  }
  return tokens.inputTokens * price.input + tokens.outputTokens * price.output;
}

// 54,000,000 → "$0.0540". Four decimals, because one extraction costs cents.
export function formatNanoUsd(nano: number | null): string {
  if (nano === null) {
    return "unknown";
  }
  const tenThousandths = roundHalfUp(nano, 100_000); // units of $0.0001
  const dollars = Math.floor(tenThousandths / 10_000);
  const fraction = String(tenThousandths % 10_000).padStart(4, "0");
  return `$${dollars}.${fraction}`;
}

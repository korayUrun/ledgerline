import { z } from "zod";

// $10,000,000 in cents. The engine multiplies amounts by up to 10,000 bps, so the
// largest product is about 10^9 × 10^4 = 10^13, far below Number.MAX_SAFE_INTEGER
// (≈ 9 × 10^15). This bound is what lets us use plain `number` instead of BigInt.
export const MAX_CENTS = 1_000_000_000;

// 10,000 bps = 100%. A share above 100% is never a valid contract term.
export const MAX_BPS = 10_000;

// Generous upper bound for ticket counts, so qtySold × priceCents stays a safe integer.
export const MAX_TICKETS = 1_000_000;

// z.int() already rejects decimals (12.5), NaN, Infinity and unsafe integers.
export const CentsSchema = z.int().min(0).max(MAX_CENTS);
export type Cents = z.infer<typeof CentsSchema>;

export const BpsSchema = z.int().min(0).max(MAX_BPS);
export type Bps = z.infer<typeof BpsSchema>;

export const TicketCountSchema = z.int().min(0).max(MAX_TICKETS);

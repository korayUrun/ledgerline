// The only place in the engine where rounding happens (CLAUDE.md, docs/domain.md §9).

// 10,000 basis points = 100%.
export const BPS_PER_WHOLE = 10_000;

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${value}`);
  }
}

// Integer division that rounds half up: 7 / 2 → 4, 5 / 4 → 1, 6 / 4 → 2.
// Uses `%` and an exact division instead of Math.round(a / b): for integers in
// the safe range both are exact, so no floating-point rounding can sneak in.
export function roundHalfUp(numerator: number, denominator: number): number {
  assertNonNegativeSafeInteger(numerator, "numerator");
  assertNonNegativeSafeInteger(denominator, "denominator");
  if (denominator === 0) {
    throw new RangeError("denominator must be greater than 0");
  }

  const remainder = numerator % denominator;
  const quotient = (numerator - remainder) / denominator;
  // "remainder is at least half of the denominator", written without a fraction.
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

// bps of an amount, rounded half up: applyBps(1_234_567, 8500) = 1_049_382.
export function applyBps(amountCents: number, bps: number): number {
  assertNonNegativeSafeInteger(amountCents, "amountCents");
  assertNonNegativeSafeInteger(bps, "bps");
  if (bps > BPS_PER_WHOLE) {
    throw new RangeError(`bps must be at most ${BPS_PER_WHOLE}, got ${bps}`);
  }
  // amountCents × bps is checked again inside roundHalfUp, so a product beyond
  // Number.MAX_SAFE_INTEGER throws instead of silently losing precision.
  return roundHalfUp(amountCents * bps, BPS_PER_WHOLE);
}

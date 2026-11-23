// The idempotency key of one payout attempt (docs/SYSTEM.md §8). Every Stripe call
// for that attempt sends it; Stripe remembers the key and answers a repeated call
// with the first result instead of making a second transfer. So a call that timed
// out can simply be sent again.
//
//   payout:<settlementId>:v<settlement version>:a<attempt>
//
// The version ties the key to the exact numbers that were approved; the attempt
// gives a retry after a real failure its own key (the old one would only replay
// the failure).
export function payoutIdempotencyKey(input: {
  settlementId: string;
  settlementVersion: number;
  attempt: number;
}): string {
  return `payout:${input.settlementId}:v${input.settlementVersion}:a${input.attempt}`;
}

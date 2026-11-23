import { describe, expect, it } from "vitest";
import { payoutIdempotencyKey } from "./payout-key.js";

describe("payoutIdempotencyKey", () => {
  it("names the settlement, the approved version and the attempt", () => {
    expect(payoutIdempotencyKey({ settlementId: "s-1", settlementVersion: 3, attempt: 1 })).toBe(
      "payout:s-1:v3:a1",
    );
  });

  it("gives a retry its own key, and the same attempt always the same key", () => {
    const first = payoutIdempotencyKey({ settlementId: "s-1", settlementVersion: 3, attempt: 1 });
    const retry = payoutIdempotencyKey({ settlementId: "s-1", settlementVersion: 3, attempt: 2 });

    expect(retry).not.toBe(first);
    expect(payoutIdempotencyKey({ settlementId: "s-1", settlementVersion: 3, attempt: 1 })).toBe(
      first,
    );
  });
});

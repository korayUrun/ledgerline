import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { PaymentConfigError, PaymentRefusedError } from "./payment-gateway.js";
import { toRefusalOrRethrow } from "./stripe-gateway.js";

// Which Stripe errors end a payout (a definite "no") and which are retried with the
// same idempotency key (the outcome is unknown). Getting this wrong either pays
// twice (a retry with a NEW key after an unknown outcome) or gives up too early.
describe("toRefusalOrRethrow", () => {
  const raw = (type: Stripe.RawErrorType) => ({ message: `${type} (test)`, type });

  it.each([
    [
      "an invalid request",
      new Stripe.errors.StripeInvalidRequestError(raw("invalid_request_error")),
    ],
    ["a permission error", new Stripe.errors.StripePermissionError(raw("invalid_request_error"))],
    [
      "an idempotency key reused with other parameters",
      new Stripe.errors.StripeIdempotencyError(raw("idempotency_error")),
    ],
  ])("treats %s as a refusal", (_label, error) => {
    expect(toRefusalOrRethrow(error)).toBeInstanceOf(PaymentRefusedError);
  });

  it("treats a rejected API key as a setup problem", () => {
    const error = new Stripe.errors.StripeAuthenticationError(raw("authentication_error"));

    expect(toRefusalOrRethrow(error)).toBeInstanceOf(PaymentConfigError);
  });

  it.each([
    ["no answer (connection)", new Stripe.errors.StripeConnectionError(raw("api_error"))],
    ["a Stripe server error", new Stripe.errors.StripeAPIError(raw("api_error"))],
    ["a rate limit", new Stripe.errors.StripeRateLimitError(raw("rate_limit_error"))],
    ["something that is not a Stripe error", new Error("socket hang up")],
  ])("passes %s through unchanged, so the job retries with the same key", (_label, error) => {
    expect(toRefusalOrRethrow(error)).toBe(error);
  });
});

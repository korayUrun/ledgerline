// What the app needs from a payment provider, in its own words. StripeGateway is the
// real one; FakePaymentGateway stands in for it in tests (and copies the behaviour
// that matters: a repeated idempotency key returns the first transfer).

export type CreateTransferInput = {
  amountCents: number;
  destinationAccountId: string; // the artist's connected account, "acct_…"
  idempotencyKey: string; // the Payout's key: a resent call never pays twice
  payoutId: string; // stored on the transfer, so the webhook can find the payout
  settlementId: string;
};

export interface PaymentGateway {
  createTransfer(input: CreateTransferInput): Promise<{ transferId: string }>;
  createConnectedAccount(input: { artistId: string; artistName: string }): Promise<{
    accountId: string;
  }>;
  createOnboardingLink(input: { accountId: string; returnUrl: string }): Promise<{ url: string }>;
}

// The provider answered and said no: an unknown or not-yet-onboarded account, not
// enough balance, a rejected request. Sending the same request again would get the
// same answer, so the payout fails and a person decides what to do.
//
// Every other error (timeout, connection reset, 5xx, rate limit) means "we do not
// know what happened". Those are retried with the same idempotency key, which is
// safe: if the first call did create the transfer, the provider returns it.
export class PaymentRefusedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "PaymentRefusedError";
  }
}

// The provider rejected our credentials (a wrong or placeholder STRIPE_SECRET_KEY).
// A setup problem, not a payment problem: the HTTP side answers 503 with this
// message, and the payout job keeps retrying until the key is fixed.
export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfigError";
  }
}

import Stripe from "stripe";
import {
  PaymentConfigError,
  PaymentRefusedError,
  type CreateTransferInput,
  type PaymentGateway,
} from "./payment-gateway.js";

// The real gateway: Stripe Connect in test mode (docs/SYSTEM.md §8). The platform
// sends a transfer from its own Stripe balance to the artist's connected account.
export class StripeGateway implements PaymentGateway {
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    // The SDK retries connection errors and 5xx itself, with the SAME idempotency
    // key, so its retries are as safe as ours.
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 30_000 });
  }

  async createTransfer(input: CreateTransferInput): Promise<{ transferId: string }> {
    try {
      const transfer = await this.stripe.transfers.create(
        {
          amount: input.amountCents, // integer cents, as everywhere in the app
          currency: "usd",
          destination: input.destinationAccountId,
          transfer_group: `settlement:${input.settlementId}`,
          metadata: { payoutId: input.payoutId, settlementId: input.settlementId },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { transferId: transfer.id };
    } catch (error) {
      throw toRefusalOrRethrow(error);
    }
  }

  async createConnectedAccount(input: {
    artistId: string;
    artistName: string;
  }): Promise<{ accountId: string }> {
    try {
      const account = await this.stripe.accounts.create(
        {
          type: "express",
          country: "US",
          business_type: "individual",
          capabilities: { transfers: { requested: true } },
          business_profile: { name: input.artistName },
          metadata: { artistId: input.artistId },
        },
        // A double click must not create two accounts for one artist.
        { idempotencyKey: `artist-account:${input.artistId}` },
      );
      return { accountId: account.id };
    } catch (error) {
      throw toRefusalOrRethrow(error);
    }
  }

  async createOnboardingLink(input: {
    accountId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    try {
      const link = await this.stripe.accountLinks.create({
        account: input.accountId,
        type: "account_onboarding",
        return_url: input.returnUrl,
        refresh_url: input.returnUrl, // an expired link sends them back to try again
      });
      return { url: link.url };
    } catch (error) {
      throw toRefusalOrRethrow(error);
    }
  }
}

// A bad key is a setup problem. Stripe answered with a definite "no" (4xx about
// the request itself): a refusal. Anything else (no answer, 5xx, 429, a lock
// conflict) is rethrown as it is, so the job retries it with the same key.
// Exported for its unit test.
export function toRefusalOrRethrow(error: unknown): unknown {
  if (error instanceof Stripe.errors.StripeAuthenticationError) {
    return new PaymentConfigError("Stripe rejected the API key: check STRIPE_SECRET_KEY.");
  }
  if (
    error instanceof Stripe.errors.StripeInvalidRequestError ||
    error instanceof Stripe.errors.StripeCardError ||
    error instanceof Stripe.errors.StripePermissionError ||
    error instanceof Stripe.errors.StripeIdempotencyError
  ) {
    return new PaymentRefusedError(`Stripe: ${error.message}`);
  }
  return error;
}

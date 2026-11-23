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
      // Accounts v2: Stripe refuses v1 account creation for new Connect platforms.
      // The artist is a "recipient": an account that can receive transfers into its
      // Stripe balance, with the Express dashboard and onboarding hosted by Stripe.
      // The transfer itself is still the v1 transfers.create above, with this id.
      //
      // No idempotency key on purpose. Stripe replays a key's FIRST answer, errors
      // included: a fixed key per artist turned one early failure (Connect not yet
      // enabled) into the same error on every later click, for 24 hours. Double
      // clicks are handled in the database instead (see the controller).
      const account = await this.stripe.v2.core.accounts.create({
        display_name: input.artistName,
        // Required for a recipient. Artists have no email in Ledgerline (synthetic
        // data only), so a placeholder on example.com, a domain reserved for examples.
        contact_email: `artist-${input.artistId.slice(0, 8)}@example.com`,
        dashboard: "express",
        identity: { country: "us", entity_type: "individual" },
        defaults: {
          currency: "usd",
          responsibilities: {
            fees_collector: "application_express",
            losses_collector: "application",
          },
        },
        configuration: {
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
          },
        },
        metadata: { artistId: input.artistId },
      });
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
      const link = await this.stripe.v2.core.accountLinks.create({
        account: input.accountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            return_url: input.returnUrl,
            refresh_url: input.returnUrl, // an expired link sends them back to try again
          },
        },
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

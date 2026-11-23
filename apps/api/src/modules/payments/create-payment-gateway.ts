import { Logger } from "@nestjs/common";
import type { StripeConfig } from "../../config.js";
import type { PaymentGateway } from "./payment-gateway.js";
import { StripeGateway } from "./stripe-gateway.js";

// The Stripe gateway when a test key is set, otherwise null: the app still runs,
// and the places that need payments say so with a 503.
export function createPaymentGateway(config: StripeConfig): PaymentGateway | null {
  if (config.secretKey === null) {
    new Logger("Payments").warn("STRIPE_SECRET_KEY is not set: approving and paying are disabled.");
    return null;
  }
  return new StripeGateway(config.secretKey);
}

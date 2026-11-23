import type { IncomingMessage } from "node:http";
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
  type RawBodyRequest,
} from "@nestjs/common";
import Stripe from "stripe";
import { CONFIG } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";
import { Public } from "../auth/auth.guard.js";
import { StripeWebhookService, type WebhookOutcome } from "./stripe-webhook.service.js";

// POST /payments/webhook — Stripe calls this; locally `stripe listen` forwards it.
// Public (Stripe has no session), so the signature is the only proof it is Stripe.
@Controller("payments")
export class StripeWebhookController {
  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(StripeWebhookService) private readonly webhooks: StripeWebhookService,
  ) {}

  @Public()
  @Post("webhook")
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<IncomingMessage>,
    @Headers("stripe-signature") signature: string | undefined,
  ): Promise<{ received: true; outcome: WebhookOutcome }> {
    const secret = this.config.stripe.webhookSecret;
    if (secret === null) {
      throw new ServiceUnavailableException("STRIPE_WEBHOOK_SECRET is not set.");
    }
    // The signature is computed over the exact bytes Stripe sent, so it is checked
    // against the raw body (createApp turns on rawBody), not re-serialized JSON.
    if (!request.rawBody || !signature) {
      throw new BadRequestException("Missing body or Stripe-Signature header.");
    }
    let event: Stripe.Event;
    try {
      // Also rejects events older than 5 minutes, so a captured request cannot be
      // replayed later.
      event = Stripe.webhooks.constructEvent(request.rawBody, signature, secret);
    } catch {
      // Break it 4: a forged or altered request stops here and changes nothing.
      throw new BadRequestException("Invalid Stripe signature.");
    }
    // A 2xx tells Stripe to stop retrying; an exception (500) makes it retry later.
    return { received: true, outcome: await this.webhooks.handle(event) };
  }
}

import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { SettlementsModule } from "../settlements/settlements.module.js";
import { ApprovalsController } from "./approvals.controller.js";
import { ApprovalsService } from "./approvals.service.js";
import { ArtistAccountsController } from "./artist-accounts.controller.js";
import { PayoutQueue } from "./payout-queue.js";
import { PayoutStateService } from "./payout-state.service.js";
import { StripeWebhookController } from "./stripe-webhook.controller.js";
import { StripeWebhookService } from "./stripe-webhook.service.js";

// F7 on the HTTP side: approval, the artist's Stripe account, and the webhook. The
// payout job runs in the worker process (WorkerModule). The PaymentGateway comes
// from AppModule (global). Depends on settlements, never the other way round.
@Module({
  imports: [SettlementsModule, AuditModule],
  controllers: [ApprovalsController, ArtistAccountsController, StripeWebhookController],
  providers: [ApprovalsService, PayoutQueue, PayoutStateService, StripeWebhookService],
})
export class PaymentsModule {}

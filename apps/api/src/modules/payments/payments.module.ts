import { Module } from "@nestjs/common";
import { SettlementsModule } from "../settlements/settlements.module.js";
import { ApprovalsController } from "./approvals.controller.js";
import { ApprovalsService } from "./approvals.service.js";

// F7: approval and payouts. The payout job and the Stripe webhook join this module
// in the next PRs. It depends on settlements (state machine, inputs), never the
// other way round.
@Module({
  imports: [SettlementsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
})
export class PaymentsModule {}

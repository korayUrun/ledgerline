import { Controller, HttpCode, Inject, Logger, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { SettlementViewDto } from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.js";
import { CurrentActor } from "../auth/auth.guard.js";
import { SettlementsService } from "../settlements/settlements.service.js";
import { ApprovalsService } from "./approvals.service.js";
import { PayoutQueue } from "./payout-queue.js";

// Human-only actions that start moving money. The agent has no tool for them and
// the MCP server (Phase 6) will have none either.
@Controller("shows/:showId/settlement")
export class ApprovalsController {
  private readonly logger = new Logger(ApprovalsController.name);

  constructor(
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @Inject(PayoutQueue) private readonly queue: PayoutQueue,
  ) {}

  @Post("approve")
  @HttpCode(200)
  async approve(
    @Param("showId", ParseUUIDPipe) showId: string,
    @CurrentActor() actor: Actor,
  ): Promise<SettlementViewDto> {
    await this.settlements.getView(showId); // 404 for an unknown show; drift check
    const payoutId = await this.approvals.approve(showId, actor);
    if (payoutId !== null) {
      await this.enqueue(payoutId);
    }
    return this.settlements.getView(showId);
  }

  @Post("retry-payment")
  @HttpCode(200)
  async retryPayment(
    @Param("showId", ParseUUIDPipe) showId: string,
    @CurrentActor() actor: Actor,
  ): Promise<SettlementViewDto> {
    await this.settlements.getView(showId);
    await this.enqueue(await this.approvals.retryPayment(showId, actor));
    return this.settlements.getView(showId);
  }

  // After the commit, never inside the transaction: a job must never see a payout
  // that might still roll back. If Redis is down now, the approval still stands
  // (it is committed) and the payout stays pending; the sweeper enqueues it within
  // minutes. So the person gets a success, not an error that would invite a retry.
  private async enqueue(payoutId: string): Promise<void> {
    try {
      await this.queue.enqueue(payoutId);
    } catch (error) {
      this.logger.warn(
        `payout ${payoutId}: enqueue failed, the sweeper will pick it up: ${String(error)}`,
      );
    }
  }
}

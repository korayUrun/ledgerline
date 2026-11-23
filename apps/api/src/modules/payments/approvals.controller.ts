import { Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { SettlementViewDto } from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.js";
import { CurrentActor } from "../auth/auth.guard.js";
import { SettlementsService } from "../settlements/settlements.service.js";
import { ApprovalsService } from "./approvals.service.js";

// Human-only actions that start moving money. The agent has no tool for them and
// the MCP server (Phase 6) will have none either.
@Controller("shows/:showId/settlement")
export class ApprovalsController {
  constructor(
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
  ) {}

  @Post("approve")
  @HttpCode(200)
  async approve(
    @Param("showId", ParseUUIDPipe) showId: string,
    @CurrentActor() actor: Actor,
  ): Promise<SettlementViewDto> {
    await this.settlements.getView(showId); // 404 for an unknown show
    await this.approvals.approve(showId, actor);
    return this.settlements.getView(showId);
  }

  @Post("retry-payment")
  @HttpCode(200)
  async retryPayment(
    @Param("showId", ParseUUIDPipe) showId: string,
    @CurrentActor() actor: Actor,
  ): Promise<SettlementViewDto> {
    await this.settlements.getView(showId);
    await this.approvals.retryPayment(showId, actor);
    return this.settlements.getView(showId);
  }
}

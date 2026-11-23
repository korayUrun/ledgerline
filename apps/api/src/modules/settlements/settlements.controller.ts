import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { SettlementViewDto } from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.js";
import { CurrentActor } from "../auth/auth.guard.js";
import { SettlementsService } from "./settlements.service.js";

@Controller("shows/:showId/settlement")
export class SettlementsController {
  constructor(@Inject(SettlementsService) private readonly settlements: SettlementsService) {}

  @Get()
  get(@Param("showId", ParseUUIDPipe) showId: string): Promise<SettlementViewDto> {
    return this.settlements.getView(showId);
  }

  // 200 rather than 201: an action on an existing resource, not a new resource.
  @Post("compute")
  @HttpCode(200)
  compute(
    @Param("showId", ParseUUIDPipe) showId: string,
    @CurrentActor() actor: Actor,
  ): Promise<SettlementViewDto> {
    return this.settlements.compute(showId, actor);
  }

  @Post("submit-for-review")
  @HttpCode(200)
  submitForReview(
    @Param("showId", ParseUUIDPipe) showId: string,
    @CurrentActor() actor: Actor,
  ): Promise<SettlementViewDto> {
    return this.settlements.submitForReview(showId, actor);
  }
}

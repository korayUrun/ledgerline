import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { SettlementViewDto } from "@ledgerline/schemas";
import { ActorService } from "../../common/actor.service.js";
import { SettlementsService } from "./settlements.service.js";

@Controller("shows/:showId/settlement")
export class SettlementsController {
  constructor(
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @Inject(ActorService) private readonly actors: ActorService,
  ) {}

  @Get()
  get(@Param("showId", ParseUUIDPipe) showId: string): Promise<SettlementViewDto> {
    return this.settlements.getView(showId);
  }

  // 200 rather than 201: an action on an existing resource, not a new resource.
  @Post("compute")
  @HttpCode(200)
  async compute(@Param("showId", ParseUUIDPipe) showId: string): Promise<SettlementViewDto> {
    return this.settlements.compute(showId, await this.actors.current());
  }

  @Post("submit-for-review")
  @HttpCode(200)
  async submitForReview(
    @Param("showId", ParseUUIDPipe) showId: string,
  ): Promise<SettlementViewDto> {
    return this.settlements.submitForReview(showId, await this.actors.current());
  }
}

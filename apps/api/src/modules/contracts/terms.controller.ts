import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { SaveTermsBodySchema, type ContractTerms, type TermsDto } from "@ledgerline/schemas";
import { ActorService } from "../../common/actor.service.js";
import { ZodBodyPipe } from "../../common/zod-body.pipe.js";
import { ShowsService } from "../shows/shows.service.js";
import { TermsService } from "./terms.service.js";

@Controller("shows/:showId/terms")
export class TermsController {
  constructor(
    @Inject(TermsService) private readonly terms: TermsService,
    @Inject(ShowsService) private readonly shows: ShowsService,
    @Inject(ActorService) private readonly actors: ActorService,
  ) {}

  @Get()
  async get(@Param("showId", ParseUUIDPipe) showId: string): Promise<TermsDto> {
    await this.shows.getShow(showId);
    return this.terms.get(showId);
  }

  // The body is the full ContractTerms object; ContractTermsSchema rejects anything
  // the engine could not compute from (a versus deal without a guarantee, a share
  // above 100%…) with a 400 before it is stored.
  @Post()
  async save(
    @Param("showId", ParseUUIDPipe) showId: string,
    @Body(new ZodBodyPipe(SaveTermsBodySchema)) body: ContractTerms,
  ): Promise<TermsDto> {
    await this.shows.getShow(showId);
    return this.terms.save(showId, body, await this.actors.current());
  }
}

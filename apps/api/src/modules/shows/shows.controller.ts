import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  CreateArtistBodySchema,
  CreateShowBodySchema,
  CreateVenueBodySchema,
  type ArtistDto,
  type CreateArtistBody,
  type CreateShowBody,
  type CreateVenueBody,
  type ShowDto,
  type VenueDto,
} from "@ledgerline/schemas";
import { ZodBodyPipe } from "../../common/zod-body.pipe.js";
import { ShowsService } from "./shows.service.js";

@Controller()
export class ShowsController {
  constructor(@Inject(ShowsService) private readonly shows: ShowsService) {}

  @Get("venues")
  listVenues(): Promise<VenueDto[]> {
    return this.shows.listVenues();
  }

  @Post("venues")
  createVenue(
    @Body(new ZodBodyPipe(CreateVenueBodySchema)) body: CreateVenueBody,
  ): Promise<VenueDto> {
    return this.shows.createVenue(body);
  }

  @Get("artists")
  listArtists(): Promise<ArtistDto[]> {
    return this.shows.listArtists();
  }

  @Post("artists")
  createArtist(
    @Body(new ZodBodyPipe(CreateArtistBodySchema)) body: CreateArtistBody,
  ): Promise<ArtistDto> {
    return this.shows.createArtist(body);
  }

  @Get("shows")
  listShows(): Promise<ShowDto[]> {
    return this.shows.listShows();
  }

  @Post("shows")
  createShow(@Body(new ZodBodyPipe(CreateShowBodySchema)) body: CreateShowBody): Promise<ShowDto> {
    return this.shows.createShow(body);
  }

  @Get("shows/:showId")
  getShow(@Param("showId", ParseUUIDPipe) showId: string): Promise<ShowDto> {
    return this.shows.getShow(showId);
  }
}

import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@ledgerline/db";
import type {
  ArtistDto,
  CreateArtistBody,
  CreateShowBody,
  CreateVenueBody,
  ShowDto,
  VenueDto,
} from "@ledgerline/schemas";
import { PRISMA } from "../../common/tokens.js";

const SHOW_INCLUDE = {
  venue: { select: { id: true, name: true } },
  artist: { select: { id: true, name: true } },
  settlement: { select: { status: true } },
} as const;

@Injectable()
export class ShowsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  listVenues(): Promise<VenueDto[]> {
    return this.prisma.venue.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  createVenue(body: CreateVenueBody): Promise<VenueDto> {
    return this.prisma.venue.create({ data: body, select: { id: true, name: true } });
  }

  listArtists(): Promise<ArtistDto[]> {
    return this.prisma.artist.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  createArtist(body: CreateArtistBody): Promise<ArtistDto> {
    return this.prisma.artist.create({ data: body, select: { id: true, name: true } });
  }

  async listShows(): Promise<ShowDto[]> {
    const shows = await this.prisma.show.findMany({
      include: SHOW_INCLUDE,
      orderBy: { showDate: "desc" },
    });
    return shows.map(toShowDto);
  }

  async getShow(showId: string): Promise<ShowDto> {
    const show = await this.prisma.show.findUnique({
      where: { id: showId },
      include: SHOW_INCLUDE,
    });
    if (!show) {
      throw new NotFoundException(`Show ${showId} not found`);
    }
    return toShowDto(show);
  }

  async createShow(body: CreateShowBody): Promise<ShowDto> {
    // Checked up front so the client gets a clear 400 instead of a foreign-key error.
    const [venue, artist] = await Promise.all([
      this.prisma.venue.findUnique({ where: { id: body.venueId } }),
      this.prisma.artist.findUnique({ where: { id: body.artistId } }),
    ]);
    if (!venue || !artist) {
      throw new BadRequestException(!venue ? "Unknown venueId" : "Unknown artistId");
    }
    const show = await this.prisma.show.create({
      data: {
        name: body.name,
        // A calendar day stored at UTC midnight in a DATE column: no time zone shifts.
        showDate: new Date(`${body.showDate}T00:00:00Z`),
        venueId: body.venueId,
        artistId: body.artistId,
      },
      include: SHOW_INCLUDE,
    });
    return toShowDto(show);
  }
}

type ShowWithRelations = {
  id: string;
  name: string;
  showDate: Date;
  venue: VenueDto;
  artist: ArtistDto;
  settlement: { status: ShowDto["settlementStatus"] & string } | null;
};

function toShowDto(show: ShowWithRelations): ShowDto {
  return {
    id: show.id,
    name: show.name,
    showDate: show.showDate.toISOString().slice(0, 10),
    venue: show.venue,
    artist: show.artist,
    settlementStatus: show.settlement?.status ?? null,
  };
}

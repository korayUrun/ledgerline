import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@ledgerline/db";
import { V1ShowListSchema, type V1ShowList } from "@ledgerline/schemas";
import { bigintToSafeNumber } from "../../common/bigint.js";
import { PRISMA } from "../../common/tokens.js";
import { checkV1Response, toMoney } from "./v1-response.js";

// Read side of the public /v1 API (F9). Shapes the data for outside tools; the
// business rules stay in the feature modules it calls.
@Injectable()
export class PublicApiService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // Newest show first, which is what "last night's settlement" needs.
  async listShows(): Promise<V1ShowList> {
    const shows = await this.prisma.show.findMany({
      include: {
        venue: { select: { name: true } },
        artist: { select: { name: true } },
        settlement: { select: { id: true, status: true, payoutCents: true } },
      },
      orderBy: [{ showDate: "desc" }, { createdAt: "desc" }],
    });
    return checkV1Response(V1ShowListSchema, {
      data: shows.map((show) => ({
        id: show.id,
        name: show.name,
        showDate: show.showDate.toISOString().slice(0, 10),
        venueName: show.venue.name,
        artistName: show.artist.name,
        settlement: show.settlement && {
          id: show.settlement.id,
          status: show.settlement.status,
          payout:
            show.settlement.payoutCents === null
              ? null
              : toMoney(bigintToSafeNumber(show.settlement.payoutCents)),
        },
      })),
    });
  }
}

import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@ledgerline/db";
import { bigintToSafeNumber } from "../../../common/bigint.js";
import { PRISMA } from "../../../common/tokens.js";
import type { WorkspaceContext } from "./workspace-context.js";

// Builds the WorkspaceContext once per run: one query for every show with the few
// facts the progress needs. The only place the workspace assistant reads the
// database, so a run answers from one consistent snapshot.
//
// Settlement statuses are the stored ones. Opening a settlement runs the drift
// check (a change made around the API turns it stale); this snapshot does not, like
// the shows list in the web app.
@Injectable()
export class WorkspaceContextLoader {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async load(): Promise<WorkspaceContext> {
    const rows = await this.prisma.show.findMany({
      orderBy: [{ showDate: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        showDate: true,
        artist: { select: { name: true } },
        venue: { select: { name: true } },
        _count: { select: { ticketSales: true } },
        expenses: {
          select: { status: true, _count: { select: { flags: { where: { status: "open" } } } } },
        },
        contracts: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
        terms: { orderBy: { version: "desc" }, take: 1, select: { version: true } },
        settlement: { select: { status: true, version: true, payoutCents: true } },
      },
    });

    return {
      shows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        showDate: row.showDate.toISOString().slice(0, 10),
        artistName: row.artist.name,
        venueName: row.venue.name,
        ticketTierCount: row._count.ticketSales,
        expenseCount: row.expenses.length,
        pendingExpenseCount: row.expenses.filter((expense) => expense.status === "pending").length,
        openFlagCount: row.expenses.reduce((count, expense) => count + expense._count.flags, 0),
        latestContractStatus: row.contracts[0]?.status ?? null,
        termsVersion: row.terms[0]?.version ?? null,
        settlement: row.settlement && {
          status: row.settlement.status,
          version: row.settlement.version,
          payoutCents:
            row.settlement.payoutCents === null
              ? null
              : bigintToSafeNumber(row.settlement.payoutCents),
        },
      })),
    };
  }
}

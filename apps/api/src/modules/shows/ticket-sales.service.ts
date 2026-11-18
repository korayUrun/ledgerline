import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient, TicketSale } from "@ledgerline/db";
import type { TicketSaleDto } from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.service.js";
import { PRISMA } from "../../common/tokens.js";
import { AuditService } from "../audit/audit.service.js";
import { SettlementStateMachine } from "../settlements/settlement-state-machine.js";
import { parseTicketSalesCsv } from "./ticket-sales-csv.js";

@Injectable()
export class TicketSalesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettlementStateMachine) private readonly stateMachine: SettlementStateMachine,
  ) {}

  async list(showId: string): Promise<TicketSaleDto[]> {
    const rows = await this.prisma.ticketSale.findMany({
      where: { showId },
      orderBy: { tierName: "asc" }, // same order as the settlement snapshot
    });
    return rows.map(toTicketSaleDto);
  }

  // An import REPLACES the show's ticket sales: a ticketing export is a full
  // picture of the show, not a list of additions. All in one transaction, so a
  // failure halfway leaves the old rows untouched.
  async importCsv(showId: string, csvText: string, actor: Actor): Promise<TicketSaleDto[]> {
    const parsed = parseTicketSalesCsv(csvText);
    if (!parsed.ok) {
      throw new BadRequestException({ message: "The CSV file has errors", issues: parsed.issues });
    }

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.ticketSale.findMany({ where: { showId } });
      await tx.ticketSale.deleteMany({ where: { showId } });
      await tx.ticketSale.createMany({ data: parsed.rows.map((row) => ({ ...row, showId })) });
      const after = await tx.ticketSale.findMany({ where: { showId } });

      await this.audit.record(tx, {
        actor: actor.label,
        action: "ticket_sales.imported",
        entity: "show",
        entityId: showId,
        before: summarize(before),
        after: summarize(after),
      });
      await this.stateMachine.markStaleIfComputed(tx, showId, actor.label, "ticket sales imported");
    });
    return this.list(showId);
  }
}

function toTicketSaleDto(row: TicketSale): TicketSaleDto {
  return {
    id: row.id,
    tierName: row.tierName,
    qtySold: row.qtySold,
    comps: row.comps,
    priceCents: row.priceCents,
    taxCents: row.taxCents,
    feeCents: row.feeCents,
  };
}

// Enough for the history to show what changed, without copying every row.
function summarize(rows: TicketSale[]): { tiers: number; paidTickets: number; grossCents: number } {
  let paidTickets = 0;
  let grossCents = 0;
  for (const row of rows) {
    paidTickets += row.qtySold;
    grossCents += row.qtySold * row.priceCents;
  }
  return { tiers: rows.length, paidTickets, grossCents };
}

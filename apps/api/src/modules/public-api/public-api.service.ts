import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@ledgerline/db";
import {
  ContractExtractionSchema,
  V1ExpenseFlagSchema,
  V1LineExplanationSchema,
  V1SettlementSchema,
  V1ShowListSchema,
  type V1ExpenseFlag,
  type V1FlagExpenseBody,
  type V1LineExplanation,
  type V1Settlement,
  type V1ShowList,
} from "@ledgerline/schemas";
import type { ApiKeyActor } from "../../common/actor.js";
import { bigintToSafeNumber } from "../../common/bigint.js";
import { PRISMA } from "../../common/tokens.js";
import { ExpenseFlagsService } from "../agent/expense-flags.service.js";
import { SettlementsService } from "../settlements/settlements.service.js";
import { explainLine } from "./line-explanation.js";
import { checkV1Response, toMoney } from "./v1-response.js";

// The public /v1 API (F9). Shapes data for outside tools; the business rules stay in
// the feature modules it calls (SettlementsService for reads with the drift check,
// ExpenseFlagsService for flags). Nothing here changes a settlement.
@Injectable()
export class PublicApiService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @Inject(ExpenseFlagsService) private readonly flags: ExpenseFlagsService,
  ) {}

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

  async getSettlement(settlementId: string): Promise<V1Settlement> {
    const showId = await this.showIdOf(settlementId);
    // The worksheet's own read: it first compares the stored result with the live
    // inputs and marks it stale if they differ, so a client never gets numbers
    // presented as current when they are not.
    const view = await this.settlements.getView(showId);
    const settlement = view.settlement;
    if (!settlement) {
      throw new NotFoundException(`Settlement ${settlementId} not found`);
    }
    const [show, openFlagCount] = await Promise.all([
      this.prisma.show.findUniqueOrThrow({
        where: { id: showId },
        include: { venue: { select: { name: true } }, artist: { select: { name: true } } },
      }),
      this.prisma.expenseFlag.count({ where: { status: "open", expense: { showId } } }),
    ]);

    return checkV1Response(V1SettlementSchema, {
      id: settlement.id,
      status: settlement.status,
      version: settlement.version,
      show: {
        id: show.id,
        name: show.name,
        showDate: show.showDate.toISOString().slice(0, 10),
        venueName: show.venue.name,
        artistName: show.artist.name,
      },
      computedAt: settlement.computedAt,
      termsVersion: settlement.termsVersion,
      payout: settlement.payoutCents === null ? null : toMoney(settlement.payoutCents),
      lines: settlement.lines.map((line, position) => ({
        position,
        kind: line.kind,
        label: line.label,
        amount: toMoney(line.amountCents),
        clauseRef: line.clauseRef,
      })),
      payments: view.payouts.map((payout) => ({
        attempt: payout.attempt,
        status: payout.status,
        amount: toMoney(payout.amountCents),
        createdAt: payout.createdAt,
      })),
      openFlagCount,
    });
  }

  async explainLine(settlementId: string, position: number): Promise<V1LineExplanation> {
    const showId = await this.showIdOf(settlementId);
    const { settlement } = await this.settlements.getView(showId);
    if (!settlement || settlement.inputSnapshot === null) {
      throw new ConflictException("This settlement has not been computed yet: it has no lines.");
    }

    const [expenses, terms] = await Promise.all([
      this.prisma.expense.findMany({
        where: { showId },
        select: { id: true, description: true },
      }),
      this.prisma.settlement.findUniqueOrThrow({
        where: { id: settlementId },
        select: { terms: { select: { contract: { select: { extractionJson: true } } } } },
      }),
    ]);
    const extractionJson = terms.terms?.contract?.extractionJson ?? null;

    const facts = explainLine(
      {
        lines: settlement.lines,
        snapshot: settlement.inputSnapshot,
        descriptions: new Map(expenses.map((expense) => [expense.id, expense.description])),
        // Parsed, not cast: what comes out of a JSON column is unknown.
        extraction: extractionJson === null ? null : ContractExtractionSchema.parse(extractionJson),
      },
      position,
    );
    if (!facts) {
      throw new NotFoundException(
        `There is no line at position ${position}. Positions go from 0 to ${settlement.lines.length - 1}.`,
      );
    }
    return checkV1Response(V1LineExplanationSchema, {
      settlementId: settlement.id,
      settlementVersion: settlement.version,
      ...facts,
    });
  }

  async flagExpense(
    expenseId: string,
    body: V1FlagExpenseBody,
    apiKey: ApiKeyActor,
  ): Promise<V1ExpenseFlag> {
    const { flag, created } = await this.flags.flagFromApiKey({ expenseId, ...body }, apiKey);
    return checkV1Response(V1ExpenseFlagSchema, {
      id: flag.id,
      expenseId: flag.expenseId,
      kind: flag.kind,
      reason: flag.reason,
      status: flag.status,
      createdAt: flag.createdAt.toISOString(),
      created,
    });
  }

  private async showIdOf(settlementId: string): Promise<string> {
    const row = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      select: { showId: true },
    });
    if (!row) {
      throw new NotFoundException(`Settlement ${settlementId} not found`);
    }
    return row.showId;
  }
}

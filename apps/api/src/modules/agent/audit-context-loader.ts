import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@ledgerline/db";
import { ContractExtractionSchema } from "@ledgerline/schemas";
import { PRISMA } from "../../common/tokens.js";
import { SettlementsService } from "../settlements/settlements.service.js";
import type { AuditContext } from "./tools/index.js";

// Builds the AuditContext the tools read (tools/audit-context.ts), once per run.
// This is the only place the agent's data comes from the database.
@Injectable()
export class AuditContextLoader {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
  ) {}

  async load(settlementId: string): Promise<AuditContext> {
    const row = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      select: {
        showId: true,
        terms: { select: { contract: { select: { extractionJson: true } } } },
      },
    });
    if (!row) {
      throw new NotFoundException(`Settlement ${settlementId} not found`);
    }

    // The worksheet's own read: it first checks the stored result against the live
    // data and marks it stale if they differ. So the agent never audits numbers
    // that no longer match the inputs.
    const { settlement } = await this.settlements.getView(row.showId);
    if (
      !settlement ||
      (settlement.status !== "computed" && settlement.status !== "in_review") ||
      settlement.payoutCents === null ||
      settlement.inputSnapshot === null ||
      settlement.termsVersion === null ||
      settlement.computedAt === null
    ) {
      throw new ConflictException(
        "The assistant needs a computed settlement whose inputs have not changed. Compute it first.",
      );
    }

    const expenses = await this.prisma.expense.findMany({
      where: { showId: row.showId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const extractionJson = row.terms?.contract?.extractionJson ?? null;

    return {
      settlement: {
        id: settlement.id,
        status: settlement.status,
        version: settlement.version,
        termsVersion: settlement.termsVersion,
        payoutCents: settlement.payoutCents,
        computedAt: settlement.computedAt,
      },
      input: settlement.inputSnapshot,
      lines: settlement.lines,
      expenses: expenses.map((expense) => ({
        id: expense.id,
        category: expense.category,
        description: expense.description,
        amountCents: expense.amountCents,
        status: expense.status,
        hasReceipt: expense.receiptKey !== null,
      })),
      // Parsed, not cast: what comes out of a JSON column is unknown.
      extraction: extractionJson === null ? null : ContractExtractionSchema.parse(extractionJson),
    };
  }
}

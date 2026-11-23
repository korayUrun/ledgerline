import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Expense, ExpenseFlag, PrismaClient } from "@ledgerline/db";
import type { ExpenseFlagKind } from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.service.js";
import { PRISMA } from "../../common/tokens.js";
import { AuditService } from "../audit/audit.service.js";

export type FlagFromAgentInput = {
  runId: string;
  expenseId: string;
  kind: ExpenseFlagKind;
  reason: string;
};

// Flags are notes on an expense, never changes to it (F6). The agent (through the
// flag_expense tool) opens them; only a person resolves them. A flag does not touch
// the engine's inputs, so it never makes the settlement stale.
@Injectable()
export class ExpenseFlagsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // created = false when the same open flag already existed: running the audit
  // twice must not pile up duplicate flags for a person to dismiss one by one.
  async flagFromAgentRun(
    input: FlagFromAgentInput,
  ): Promise<{ flag: ExpenseFlag; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.agentRun.findUniqueOrThrow({
        where: { id: input.runId },
        select: { settlement: { select: { showId: true } } },
      });
      const expense = await tx.expense.findUnique({ where: { id: input.expenseId } });
      // The agent only ever sees this show's expenses. An id from anywhere else (a
      // typo, or an id planted in some expense's description) is refused.
      if (!expense || expense.showId !== run.settlement.showId) {
        throw new NotFoundException(`There is no expense ${input.expenseId} in this show.`);
      }

      const existing = await tx.expenseFlag.findFirst({
        where: { expenseId: input.expenseId, kind: input.kind, status: "open" },
      });
      if (existing) {
        return { flag: existing, created: false };
      }

      const flag = await tx.expenseFlag.create({
        data: {
          expenseId: input.expenseId,
          agentRunId: input.runId,
          kind: input.kind,
          reason: input.reason,
        },
      });
      await this.audit.record(tx, {
        actor: `agent:${input.runId}`,
        action: "expense.flagged",
        entity: "expense",
        entityId: input.expenseId,
        before: null,
        after: { flagId: flag.id, kind: flag.kind, reason: flag.reason },
      });
      return { flag, created: true };
    });
  }

  // Every flag on the settlement's show, open ones first, then newest first.
  async listForSettlement(settlementId: string): Promise<(ExpenseFlag & { expense: Expense })[]> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      select: { showId: true },
    });
    if (!settlement) {
      throw new NotFoundException(`Settlement ${settlementId} not found`);
    }
    const flags = await this.prisma.expenseFlag.findMany({
      where: { expense: { showId: settlement.showId } },
      include: { expense: true },
      orderBy: { createdAt: "desc" },
    });
    // Sorted here rather than in SQL: ordering by the enum would follow its
    // declaration order, which is an accident of the schema file.
    return [
      ...flags.filter((f) => f.status === "open"),
      ...flags.filter((f) => f.status !== "open"),
    ];
  }

  // accepted = the person agrees (and changes the expense separately, e.g. marks it
  // disallowed); dismissed = the person disagrees. Either way the decision is theirs.
  async resolve(
    flagId: string,
    resolution: "accepted" | "dismissed",
    actor: Actor,
  ): Promise<ExpenseFlag & { expense: Expense }> {
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.expenseFlag.findUnique({ where: { id: flagId } });
      if (!flag) {
        throw new NotFoundException(`Flag ${flagId} not found`);
      }
      // Compare-and-set, like the settlement state machine: only an open flag can be
      // resolved, and of two people resolving it at once, exactly one wins.
      const { count } = await tx.expenseFlag.updateMany({
        where: { id: flagId, status: "open" },
        data: { status: resolution, resolvedById: actor.userId, resolvedAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException(`This flag was already ${flag.status}.`);
      }
      await this.audit.record(tx, {
        actor: actor.label,
        action: "expense.flag_resolved",
        entity: "expense",
        entityId: flag.expenseId,
        before: { flagId, status: flag.status },
        after: { flagId, status: resolution },
      });
      return tx.expenseFlag.findUniqueOrThrow({
        where: { id: flagId },
        include: { expense: true },
      });
    });
  }
}

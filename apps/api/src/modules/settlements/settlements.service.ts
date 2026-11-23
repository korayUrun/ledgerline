import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma, type PrismaClient, type Settlement } from "@ledgerline/db";
import type { SettlementViewDto } from "@ledgerline/schemas";
import { computeSettlement, ENGINE_VERSION } from "@ledgerline/settlement-engine";
import { SYSTEM_ACTOR_LABEL, type Actor } from "../../common/actor.js";
import { PRISMA } from "../../common/tokens.js";
import { AuditService } from "../audit/audit.service.js";
import { toSettlementDto } from "./settlement-dto.js";
import { hashSettlementInput, loadLiveInputs } from "./settlement-inputs.js";
import { SettlementStateMachine } from "./settlement-state-machine.js";

@Injectable()
export class SettlementsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(SettlementStateMachine) private readonly stateMachine: SettlementStateMachine,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async getView(showId: string): Promise<SettlementViewDto> {
    await this.assertShowExists(showId);
    await this.detectInputDrift(showId);

    const settlement = await this.prisma.settlement.findUnique({
      where: { showId },
      include: { lines: { orderBy: { position: "asc" } }, terms: { select: { version: true } } },
    });
    const pendingExpenseCount = await this.prisma.expense.count({
      where: { showId, status: "pending" },
    });
    return {
      settlement: settlement ? toSettlementDto(settlement) : null,
      pendingExpenseCount,
    };
  }

  // Compute = freeze the live inputs, run the pure engine on them, store the result.
  async compute(showId: string, actor: Actor): Promise<SettlementViewDto> {
    await this.assertShowExists(showId);
    const settlement = await this.findOrCreateDraft(showId, actor);

    const live = await loadLiveInputs(this.prisma, showId);
    if (!live) {
      throw new UnprocessableEntityException(
        "This show has no terms yet. Save the deal terms before computing.",
      );
    }
    // Pure and synchronous. Throws a ZodError if the stored inputs break an engine
    // rule (e.g. total gross above MAX_CENTS); ApiExceptionFilter turns that into a 422.
    const result = computeSettlement(live.input);
    const inputsHash = hashSettlementInput(live.input);

    await this.prisma.$transaction(async (tx) => {
      // The compare-and-set inside transition() is what makes two concurrent
      // computes safe: both read version N, the first one writes N + 1, and the
      // second one's UPDATE (WHERE version = N) matches 0 rows and gets a 409.
      await this.stateMachine.transition(tx, {
        settlement,
        to: "computed",
        actor: actor.label,
        action: "settlement.computed",
        data: {
          version: { increment: 1 },
          termsId: live.termsId,
          inputSnapshot: live.input,
          inputsHash,
          engineVersion: ENGINE_VERSION,
          payoutCents: BigInt(result.payoutCents),
          computedAt: new Date(),
        },
      });

      // Lines are replaced as a whole: they belong to this computation only.
      await tx.settlementLine.deleteMany({ where: { settlementId: settlement.id } });
      await tx.settlementLine.createMany({
        data: result.lines.map((line, position) => ({
          settlementId: settlement.id,
          position,
          kind: line.kind,
          label: line.label,
          amountCents: BigInt(line.amountCents),
          clauseRef: line.clauseRef,
          sourceRefs: line.sourceRefs,
        })),
      });
    });

    return this.getView(showId);
  }

  // computed → in_review. The "pending expenses" rule lives here, not in the engine:
  // you may compute with unreviewed expenses to preview the number, but you may not
  // send a settlement for review while any expense is still undecided.
  async submitForReview(showId: string, actor: Actor): Promise<SettlementViewDto> {
    await this.assertShowExists(showId);
    await this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({ where: { showId } });
      if (!settlement) {
        throw new NotFoundException("This show has no settlement yet. Compute it first.");
      }

      const pendingExpenseCount = await tx.expense.count({ where: { showId, status: "pending" } });
      if (pendingExpenseCount > 0) {
        throw new ConflictException(
          `${pendingExpenseCount} expense(s) are still pending. Allow or disallow them, then recompute.`,
        );
      }

      // Same idea for the audit agent's flags (F6): the agent only points at
      // problems, so a person must accept or dismiss each one before review.
      const openFlagCount = await tx.expenseFlag.count({
        where: { status: "open", expense: { showId } },
      });
      if (openFlagCount > 0) {
        throw new ConflictException(
          `${openFlagCount} assistant flag(s) are still open. Accept or dismiss them first.`,
        );
      }

      // Never send a result for review that no longer matches the data.
      const live = await loadLiveInputs(tx, showId);
      if (!live || hashSettlementInput(live.input) !== settlement.inputsHash) {
        throw new ConflictException("The inputs changed since the last compute. Recompute first.");
      }

      await this.stateMachine.transition(tx, {
        settlement,
        to: "in_review",
        actor: actor.label,
        action: "settlement.submitted_for_review",
      });
    });
    return this.getView(showId);
  }

  // Stale detection, layer 2. Layer 1 is the services that change inputs: they call
  // markStaleIfComputed() in the same transaction. That cannot see changes made
  // around the API (a manual SQL UPDATE, a bug in some future code path). This check
  // can: it hashes the live rows and compares the result with the stored inputsHash.
  private async detectInputDrift(showId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const settlement = await tx.settlement.findUnique({ where: { showId } });
        if (!settlement || !this.stateMachine.isStaleable(settlement.status)) {
          return;
        }
        const live = await loadLiveInputs(tx, showId);
        const liveHash = live ? hashSettlementInput(live.input) : null;
        if (liveHash === settlement.inputsHash) {
          return;
        }
        await this.stateMachine.transition(tx, {
          settlement,
          to: "stale",
          actor: SYSTEM_ACTOR_LABEL,
          action: "settlement.marked_stale",
          details: { reason: "live inputs no longer match the stored inputsHash" },
        });
      });
    } catch (error) {
      // Two reads noticed the drift at the same time and the other one already
      // marked it stale. That is the outcome we wanted, so this read carries on.
      if (!(error instanceof ConflictException)) {
        throw error;
      }
    }
  }

  private async findOrCreateDraft(showId: string, actor: Actor): Promise<Settlement> {
    const existing = await this.prisma.settlement.findUnique({ where: { showId } });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.settlement.create({ data: { showId } });
        await this.audit.record(tx, {
          actor: actor.label,
          action: "settlement.created",
          entity: "settlement",
          entityId: created.id,
          before: null,
          after: { status: created.status, version: created.version },
        });
        return created;
      });
    } catch (error) {
      // Two requests tried to create the settlement at once. The unique index on
      // showId let exactly one of them win; use the row it created.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return this.prisma.settlement.findUniqueOrThrow({ where: { showId } });
      }
      throw error;
    }
  }

  private async assertShowExists(showId: string): Promise<void> {
    const show = await this.prisma.show.findUnique({ where: { id: showId }, select: { id: true } });
    if (!show) {
      throw new NotFoundException(`Show ${showId} not found`);
    }
  }
}

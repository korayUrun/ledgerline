import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@ledgerline/db";
import { ContractTermsSchema, type ContractTerms, type TermsDto } from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.js";
import { PRISMA } from "../../common/tokens.js";
import { AuditService } from "../audit/audit.service.js";
import { SettlementStateMachine } from "../settlements/settlement-state-machine.js";

// Versioned deal terms. A version is created either by typing the terms in (save)
// or by confirming an extracted contract (ContractsService.confirm). Both go
// through createVersion, so the rules are the same.
@Injectable()
export class TermsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettlementStateMachine) private readonly stateMachine: SettlementStateMachine,
  ) {}

  async get(showId: string): Promise<TermsDto> {
    const rows = await this.prisma.contractTerms.findMany({
      where: { showId },
      orderBy: { version: "desc" },
      include: { confirmedBy: { select: { name: true } } },
    });
    const versions = rows.map((row) => ({
      id: row.id,
      version: row.version,
      confirmedByName: row.confirmedBy.name,
      confirmedAt: row.confirmedAt.toISOString(),
      contractId: row.contractId,
    }));
    const latestRow = rows[0];
    return {
      // termsJson is parsed, not cast: what comes out of a JSON column is unknown.
      latest: latestRow
        ? { ...versions[0]!, terms: ContractTermsSchema.parse(latestRow.termsJson) }
        : null,
      versions,
    };
  }

  async save(showId: string, terms: ContractTerms, actor: Actor): Promise<TermsDto> {
    await this.prisma.$transaction((tx) => this.createVersion(tx, { showId, terms, actor }));
    return this.get(showId);
  }

  // Never updates a row: every save is a new version. The unique index on
  // (showId, version) means two simultaneous saves cannot both become version N;
  // the loser gets a P2002, which ApiExceptionFilter turns into a 409.
  //
  // Takes the caller's transaction, so confirming a contract can create the
  // version and move the contract to "confirmed" in one atomic step.
  async createVersion(
    tx: Prisma.TransactionClient,
    input: { showId: string; terms: ContractTerms; actor: Actor; contractId?: string },
  ): Promise<{ id: string; version: number }> {
    const { showId, terms, actor } = input;
    const latest = await tx.contractTerms.findFirst({
      where: { showId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    const created = await tx.contractTerms.create({
      data: {
        showId,
        version,
        termsJson: terms,
        // Typed in, or reviewed, by a person: that person has confirmed them.
        confirmedById: actor.userId,
        confirmedAt: new Date(),
        contractId: input.contractId ?? null,
      },
    });
    await this.audit.record(tx, {
      actor: actor.label,
      action: "terms.saved",
      entity: "show",
      entityId: showId,
      before: latest ? { version: latest.version } : null,
      after: {
        version,
        termsId: created.id,
        dealType: terms.deal.type,
        contractId: input.contractId ?? null,
      },
    });
    await this.stateMachine.onInputChange(
      tx,
      showId,
      actor.label,
      `terms version ${version} saved`,
    );
    return { id: created.id, version };
  }
}

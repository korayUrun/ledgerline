import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@ledgerline/db";
import type { AuditEntryDto } from "@ledgerline/schemas";
import { PRISMA } from "../../common/tokens.js";

export type AuditEntry = {
  actor: string;
  action: string; // "<entity>.<verb>", e.g. "settlement.computed"
  entity: string;
  entityId: string;
  before: Prisma.InputJsonValue | null;
  after: Prisma.InputJsonValue | null;
};

@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // Takes the transaction client, never the global one, on purpose: the audit row
  // must commit or roll back together with the change it describes. If the change
  // fails, there is no audit row claiming it happened; if the audit write fails,
  // the change is rolled back too.
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        actor: entry.actor,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        // DbNull stores SQL NULL ("no value") rather than the JSON value null.
        before: entry.before ?? Prisma.DbNull,
        after: entry.after ?? Prisma.DbNull,
      },
    });
  }

  async list(entity: string, entityId: string): Promise<AuditEntryDto[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { at: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      before: row.before,
      after: row.after,
      at: row.at.toISOString(),
    }));
  }
}

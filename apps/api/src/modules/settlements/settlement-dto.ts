import type { Settlement, SettlementLine as SettlementLineRow } from "@ledgerline/db";
import {
  SettlementInputSchema,
  SourceRefSchema,
  type SettlementDto,
  type SettlementLine,
} from "@ledgerline/schemas";
import { bigintToSafeNumber } from "../../common/bigint.js";

export type SettlementWithLines = Settlement & {
  lines: SettlementLineRow[];
  terms: { version: number } | null;
};

// Database row → API response. BigInt becomes number, Date becomes an ISO string,
// and the JSON columns are parsed back into their Zod types rather than cast.
export function toSettlementDto(settlement: SettlementWithLines): SettlementDto {
  return {
    id: settlement.id,
    status: settlement.status,
    version: settlement.version,
    termsVersion: settlement.terms?.version ?? null,
    payoutCents:
      settlement.payoutCents === null ? null : bigintToSafeNumber(settlement.payoutCents),
    inputsHash: settlement.inputsHash,
    engineVersion: settlement.engineVersion,
    computedAt: settlement.computedAt?.toISOString() ?? null,
    inputSnapshot:
      settlement.inputSnapshot === null
        ? null
        : SettlementInputSchema.parse(settlement.inputSnapshot),
    lines: settlement.lines.map(toLine),
  };
}

function toLine(row: SettlementLineRow): SettlementLine {
  return {
    kind: row.kind,
    label: row.label,
    amountCents: bigintToSafeNumber(row.amountCents),
    clauseRef: row.clauseRef,
    sourceRefs: SourceRefSchema.array().parse(row.sourceRefs),
  };
}

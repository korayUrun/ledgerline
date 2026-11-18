import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Contract, Prisma } from "@ledgerline/db";
import type { ContractStatus } from "@ledgerline/schemas";
import { AuditService } from "../audit/audit.service.js";

// Every legal move of a contract, and nothing else (docs/SYSTEM.md §5).
//
//   uploaded ──▶ extracting ──▶ needs_review ──▶ confirmed
//                    │
//                    └──▶ failed
//
// confirmed and failed are final. A failed or wrong extraction is handled by
// uploading the PDF again, which keeps every attempt in the history.
export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  uploaded: ["extracting"],
  extracting: ["needs_review", "failed"],
  needs_review: ["confirmed"],
  confirmed: [],
  failed: [],
};

export function canTransitionContract(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

export type ContractTransitionRequest = {
  contract: Contract; // as the caller read it; its status is the expected value
  to: ContractStatus;
  actor: string;
  action: string;
  data?: Prisma.ContractUncheckedUpdateManyInput;
  details?: Prisma.InputJsonObject;
};

// The only code allowed to change Contract.status. Same pattern as the
// settlement state machine: a guarded table, a compare-and-set UPDATE, and the
// audit row in the caller's transaction.
@Injectable()
export class ContractStateMachine {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async transition(
    tx: Prisma.TransactionClient,
    request: ContractTransitionRequest,
  ): Promise<Contract> {
    const { contract, to } = request;
    if (!canTransitionContract(contract.status, to)) {
      throw new ConflictException(`A contract cannot move from ${contract.status} to ${to}.`);
    }

    // Matches only if nobody changed the status since the caller read it. Two
    // workers finishing the same job, or two reviewers confirming at once: the
    // second one matches 0 rows and is refused instead of overwriting the first.
    const { count } = await tx.contract.updateMany({
      where: { id: contract.id, status: contract.status },
      data: { ...request.data, status: to },
    });
    if (count === 0) {
      throw new ConflictException(
        "The contract was changed by another request while this one was running. Reload and try again.",
      );
    }

    const updated = await tx.contract.findUniqueOrThrow({ where: { id: contract.id } });
    await this.audit.record(tx, {
      actor: request.actor,
      action: request.action,
      entity: "contract",
      entityId: contract.id,
      before: { status: contract.status },
      after: { status: updated.status, ...request.details },
    });
    return updated;
  }
}

import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Prisma, Settlement } from "@ledgerline/db";
import type { SettlementStatus } from "@ledgerline/schemas";
import { bigintToSafeNumber } from "../../common/bigint.js";
import { AuditService } from "../audit/audit.service.js";

// Every legal move, and nothing else (docs/SYSTEM.md §5).
//
//   draft ──▶ computed ──▶ in_review ──▶ approved ──▶ paying ──▶ paid
//               ▲  │ ↺         │            │          │  ▲
//               │  ▼           │            └──────────┼──┼──▶ paid  (nothing to pay)
//               └─ stale ◀─────┘                       ▼  │
//                 (inputs changed)               payment_failed  (a person retries)
//
// computed → computed is a recompute with no input change (it does no harm).
// in_review cannot be recomputed directly: if its inputs changed it goes stale first.
// From approved on, the inputs are locked (see onInputChange), and paid is final.
export const SETTLEMENT_TRANSITIONS: Record<SettlementStatus, readonly SettlementStatus[]> = {
  draft: ["computed"],
  computed: ["computed", "in_review", "stale"],
  in_review: ["stale", "approved"],
  stale: ["computed"],
  // paying in the same transaction as the approval; paid directly only when the
  // payout is $0 (Stripe cannot transfer nothing).
  approved: ["paying", "paid"],
  paying: ["paid", "payment_failed"],
  payment_failed: ["paying"],
  paid: [],
};

export function canTransition(from: SettlementStatus, to: SettlementStatus): boolean {
  return SETTLEMENT_TRANSITIONS[from].includes(to);
}

// The statuses whose result was computed from inputs that may since have changed.
const STATUSES_THAT_CAN_GO_STALE: readonly SettlementStatus[] = ["computed", "in_review"];

// Once a person has approved the number, the inputs behind it must not move: the
// money is (about to be) on its way. Edits are refused instead of making it stale.
const STATUSES_WITH_LOCKED_INPUTS: readonly SettlementStatus[] = [
  "approved",
  "paying",
  "paid",
  "payment_failed",
];

export type TransitionRequest = {
  // The row exactly as the caller read it. Its status and version are the
  // "expected" values for the compare-and-set below.
  settlement: Settlement;
  to: SettlementStatus;
  actor: string;
  action: string;
  // Extra columns to set in the same UPDATE (compute sets the snapshot, hash…).
  data?: Prisma.SettlementUncheckedUpdateManyInput;
  // Extra facts for the audit row, e.g. why the settlement went stale.
  details?: Record<string, string>;
};

// The only code allowed to change Settlement.status (CLAUDE.md rule).
@Injectable()
export class SettlementStateMachine {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // Must be called inside a transaction: the status change and its audit row are
  // written together or not at all.
  async transition(tx: Prisma.TransactionClient, request: TransitionRequest): Promise<Settlement> {
    const { settlement, to } = request;
    if (!canTransition(settlement.status, to)) {
      throw new ConflictException(`A settlement cannot move from ${settlement.status} to ${to}.`);
    }

    // Compare-and-set: the UPDATE only matches if status and version are still what
    // the caller read. If another request changed the row in between, 0 rows match
    // and we refuse, instead of overwriting their change ("lost update").
    const { count } = await tx.settlement.updateMany({
      where: { id: settlement.id, status: settlement.status, version: settlement.version },
      data: { ...request.data, status: to },
    });
    if (count === 0) {
      throw new ConflictException(
        "The settlement was changed by another request while this one was running. Reload and try again.",
      );
    }

    const updated = await tx.settlement.findUniqueOrThrow({ where: { id: settlement.id } });
    await this.audit.record(tx, {
      actor: request.actor,
      action: request.action,
      entity: "settlement",
      entityId: settlement.id,
      before: auditSnapshot(settlement),
      after: { ...auditSnapshot(updated), ...request.details },
    });
    return updated;
  }

  // Called by every service that changes an input (ticket sales, expenses, terms),
  // inside the same transaction as that change:
  //   - approved or later: refuse (409), so the whole change rolls back;
  //   - computed or in_review: mark it stale;
  //   - draft or already stale: nothing to invalidate.
  async onInputChange(
    tx: Prisma.TransactionClient,
    showId: string,
    actor: string,
    reason: string,
  ): Promise<void> {
    const settlement = await tx.settlement.findUnique({ where: { showId } });
    if (settlement && STATUSES_WITH_LOCKED_INPUTS.includes(settlement.status)) {
      throw new ConflictException(
        `The settlement is ${settlement.status.replace("_", " ")}: its inputs can no longer change.`,
      );
    }
    if (!settlement || !STATUSES_THAT_CAN_GO_STALE.includes(settlement.status)) {
      return;
    }
    await this.transition(tx, {
      settlement,
      to: "stale",
      actor,
      action: "settlement.marked_stale",
      details: { reason },
    });
  }

  isStaleable(status: SettlementStatus): boolean {
    return STATUSES_THAT_CAN_GO_STALE.includes(status);
  }

  // Approved or later: the numbers are final, so the inputs (and notes about them,
  // such as expense flags from API clients) can no longer change.
  hasLockedInputs(status: SettlementStatus): boolean {
    return STATUSES_WITH_LOCKED_INPUTS.includes(status);
  }
}

// The fields worth seeing in the history. The snapshot and lines are left out:
// they are large and already stored on the settlement itself.
function auditSnapshot(settlement: Settlement): Prisma.InputJsonObject {
  return {
    status: settlement.status,
    version: settlement.version,
    payoutCents:
      settlement.payoutCents === null ? null : bigintToSafeNumber(settlement.payoutCents),
    inputsHash: settlement.inputsHash,
  };
}

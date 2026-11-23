import { Inject, Injectable } from "@nestjs/common";
import type { Payout, Prisma } from "@ledgerline/db";
import { AuditService } from "../audit/audit.service.js";
import { SettlementStateMachine } from "../settlements/settlement-state-machine.js";

//   pending ──▶ processing ──▶ succeeded   (the webhook confirms the transfer)
//      │            │
//      └────────────┴──────▶ failed        (the provider refused)
//
// The only code that changes Payout.status. Each method runs in the caller's
// transaction, does a compare-and-set on the payout's status (so a duplicate job or
// webhook changes nothing), and moves the settlement with it through the state
// machine, so a payout and its settlement can never disagree.
@Injectable()
export class PayoutStateService {
  constructor(
    @Inject(SettlementStateMachine) private readonly stateMachine: SettlementStateMachine,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // pending → processing, just before the transfer call. Nothing changes if it is
  // already processing (a retried job).
  async markProcessing(tx: Prisma.TransactionClient, payout: Payout): Promise<void> {
    await tx.payout.updateMany({
      where: { id: payout.id, status: "pending" },
      data: { status: "processing" },
    });
  }

  // The provider accepted the transfer. The payout stays processing: the webhook
  // is what confirms it. Returns false if the payout was already past this point.
  async recordTransfer(
    tx: Prisma.TransactionClient,
    payout: Payout,
    transferId: string,
    actor: string,
  ): Promise<boolean> {
    const { count } = await tx.payout.updateMany({
      where: { id: payout.id, status: { in: ["pending", "processing"] }, stripeTransferId: null },
      data: { status: "processing", stripeTransferId: transferId },
    });
    if (count === 1) {
      await this.audit.record(tx, {
        actor,
        action: "payout.transfer_created",
        entity: "payout",
        entityId: payout.id,
        before: { status: payout.status },
        after: { status: "processing", stripeTransferId: transferId },
      });
    }
    return count === 1;
  }

  // processing → succeeded, settlement paying → paid. Returns false if the payout
  // was not waiting for this (already succeeded, or failed).
  async markSucceeded(
    tx: Prisma.TransactionClient,
    payout: Payout,
    transferId: string,
    actor: string,
  ): Promise<boolean> {
    const { count } = await tx.payout.updateMany({
      where: { id: payout.id, status: { in: ["pending", "processing"] } },
      data: { status: "succeeded", stripeTransferId: transferId },
    });
    if (count === 0) {
      return false;
    }
    const settlement = await tx.settlement.findUniqueOrThrow({
      where: { id: payout.settlementId },
    });
    await this.stateMachine.transition(tx, {
      settlement,
      to: "paid",
      actor,
      action: "settlement.paid",
      details: { payoutId: payout.id, stripeTransferId: transferId },
    });
    return true;
  }

  // pending|processing → failed, settlement paying → payment_failed. A person can
  // then retry (a new attempt with a new key).
  async markFailed(
    tx: Prisma.TransactionClient,
    payout: Payout,
    reason: string,
    actor: string,
  ): Promise<boolean> {
    const { count } = await tx.payout.updateMany({
      where: { id: payout.id, status: { in: ["pending", "processing"] } },
      data: { status: "failed", failureReason: reason },
    });
    if (count === 0) {
      return false;
    }
    const settlement = await tx.settlement.findUniqueOrThrow({
      where: { id: payout.settlementId },
    });
    await this.stateMachine.transition(tx, {
      settlement,
      to: "payment_failed",
      actor,
      action: "settlement.payment_failed",
      details: { payoutId: payout.id, reason },
    });
    return true;
  }
}

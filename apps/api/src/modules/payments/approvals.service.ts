import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma, PrismaClient, Settlement } from "@ledgerline/db";
import type { Actor } from "../../common/actor.js";
import { PAYMENT_GATEWAY, PRISMA } from "../../common/tokens.js";
import { hashSettlementInput, loadLiveInputs } from "../settlements/settlement-inputs.js";
import { SettlementStateMachine } from "../settlements/settlement-state-machine.js";
import type { PaymentGateway } from "./payment-gateway.js";
import { payoutIdempotencyKey } from "./payout-key.js";

// Approval and the start of each payout attempt (F7, docs/SYSTEM.md §8).
//
// Only a person reaches these methods: the routes need a logged-in session, and
// neither the agent nor (in Phase 6) an API key has a path to them.
//
// Each method is ONE transaction: the status change, the Payout row and the audit
// rows are committed together or not at all. So "approved" can never exist without
// the intent to pay, and a crash right after the commit leaves a pending Payout
// that the payout job (or the sweeper) will find. Sending the money is not done
// here: the controller enqueues the payout job after the commit.
@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(SettlementStateMachine) private readonly stateMachine: SettlementStateMachine,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
  ) {}

  // in_review → approved → paying, with Payout attempt 1. A $0 payout goes straight
  // to paid: there is nothing to transfer. Returns the payout to send, if any.
  async approve(showId: string, actor: Actor): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const settlement = await findSettlement(tx, showId);
      if (settlement.status !== "in_review") {
        throw new ConflictException(
          `Only a settlement in review can be approved; this one is ${settlement.status}.`,
        );
      }
      // Never approve numbers that no longer match the data (the same check as
      // submit-for-review, repeated because time has passed since).
      const live = await loadLiveInputs(tx, showId);
      if (!live || hashSettlementInput(live.input) !== settlement.inputsHash) {
        throw new ConflictException("The inputs changed since the last compute. Recompute first.");
      }
      await this.assertCanPay(tx, showId, settlement);

      // Compare-and-set inside: of two approvals clicked at once, the second one's
      // UPDATE … WHERE status = 'in_review' matches nothing and it gets a 409.
      const approved = await this.stateMachine.transition(tx, {
        settlement,
        to: "approved",
        actor: actor.label,
        action: "settlement.approved",
      });

      if (approved.payoutCents === 0n) {
        await this.stateMachine.transition(tx, {
          settlement: approved,
          to: "paid",
          actor: actor.label,
          action: "settlement.paid",
          details: { reason: "nothing to pay" },
        });
        return null;
      }
      return this.startAttempt(tx, approved, 1, actor);
    });
  }

  // payment_failed → paying, with a NEW Payout (attempt + 1, new idempotency key).
  async retryPayment(showId: string, actor: Actor): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const settlement = await findSettlement(tx, showId);
      if (settlement.status !== "payment_failed") {
        throw new ConflictException(
          `Only a failed payment can be retried; this settlement is ${settlement.status}.`,
        );
      }
      const last = await tx.payout.findFirst({
        where: { settlementId: settlement.id },
        orderBy: { attempt: "desc" },
      });
      // payment_failed is only ever set together with a failed payout, so this is
      // a broken invariant, not a user mistake.
      if (!last || last.status !== "failed") {
        throw new ConflictException("The last payout has not failed; it cannot be retried.");
      }
      // The usual cause of a failure is the artist's account; check it again.
      await this.assertCanPay(tx, showId, settlement);
      return this.startAttempt(tx, settlement, last.attempt + 1, actor);
    });
  }

  // Refuse up front what would only fail in the job: no Stripe key, or an artist
  // with no connected account to send to. A $0 payout needs neither.
  private async assertCanPay(
    tx: Prisma.TransactionClient,
    showId: string,
    settlement: Settlement,
  ): Promise<void> {
    if (settlement.payoutCents === 0n) {
      return;
    }
    if (this.gateway === null) {
      throw new ServiceUnavailableException(
        "Payments are not configured: set STRIPE_SECRET_KEY (test mode) and restart.",
      );
    }
    const show = await tx.show.findUniqueOrThrow({
      where: { id: showId },
      select: { artist: { select: { stripeAccountId: true } } },
    });
    if (show.artist.stripeAccountId === null) {
      throw new ConflictException(
        "The artist has no Stripe account yet. Set it up first (Connect Stripe account).",
      );
    }
  }

  // Writes the Payout row and moves the settlement to paying, in the caller's
  // transaction. Two concurrent retries would both try attempt N: the unique index
  // on (settlementId, attempt) lets exactly one insert succeed.
  private async startAttempt(
    tx: Prisma.TransactionClient,
    settlement: Settlement,
    attempt: number,
    actor: Actor,
  ): Promise<string> {
    if (settlement.payoutCents === null) {
      throw new ConflictException("The settlement has no computed payout.");
    }
    const payout = await tx.payout.create({
      data: {
        settlementId: settlement.id,
        settlementVersion: settlement.version,
        attempt,
        amountCents: settlement.payoutCents,
        idempotencyKey: payoutIdempotencyKey({
          settlementId: settlement.id,
          settlementVersion: settlement.version,
          attempt,
        }),
        createdById: actor.userId,
      },
    });
    await this.stateMachine.transition(tx, {
      settlement,
      to: "paying",
      actor: actor.label,
      action: "settlement.payment_started",
      details: {
        payoutId: payout.id,
        attempt: String(attempt),
        idempotencyKey: payout.idempotencyKey,
      },
    });
    return payout.id;
  }
}

async function findSettlement(tx: Prisma.TransactionClient, showId: string): Promise<Settlement> {
  const settlement = await tx.settlement.findUnique({ where: { showId } });
  if (!settlement) {
    throw new NotFoundException("This show has no settlement yet. Compute it first.");
  }
  return settlement;
}

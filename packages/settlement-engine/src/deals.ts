import type { Deal, SettlementLine } from "@ledgerline/schemas";
import { applyBps } from "./money.js";

// The four deal formulas (docs/domain.md §4–§7, rules R5 and R6).
// Each function returns its lines in the order a reader follows the math,
// ending with the deal_payout line.
export interface DealOutcome {
  dealPayoutCents: number;
  lines: SettlementLine[];
}

type FlatDeal = Extract<Deal, { type: "flat" }>;
type PercentageDeal = Extract<Deal, { type: "percentage" }>;
type VersusDeal = Extract<Deal, { type: "versus" }>;
type GuaranteePlusDeal = Extract<Deal, { type: "guarantee_plus" }>;

function guaranteeLine(deal: FlatDeal | VersusDeal | GuaranteePlusDeal): SettlementLine {
  return {
    kind: "guarantee",
    label: "Guarantee",
    amountCents: deal.guaranteeCents,
    clauseRef: deal.clauseRef,
    sourceRefs: [],
  };
}

function dealPayoutLine(deal: Deal, label: string, amountCents: number): SettlementLine {
  return { kind: "deal_payout", label, amountCents, clauseRef: deal.clauseRef, sourceRefs: [] };
}

// Payout = guarantee. Sales and expenses do not change it.
export function computeFlatDeal(deal: FlatDeal): DealOutcome {
  return {
    dealPayoutCents: deal.guaranteeCents,
    lines: [
      guaranteeLine(deal),
      dealPayoutLine(deal, "Deal payout: flat guarantee", deal.guaranteeCents),
    ],
  };
}

// Payout = share of NBOR. Expenses are not deducted.
export function computePercentageDeal(deal: PercentageDeal, netCents: number): DealOutcome {
  const shareCents = applyBps(netCents, deal.artistShareBps);
  return {
    dealPayoutCents: shareCents,
    lines: [
      {
        kind: "percentage_share",
        label: "Artist share of NBOR",
        amountCents: shareCents,
        clauseRef: deal.clauseRef,
        sourceRefs: [],
      },
      dealPayoutLine(deal, "Deal payout: percentage of NBOR", shareCents),
    ],
  };
}

// Payout = the larger of the guarantee and the share of (NBOR − expenses).
// The guarantee is a floor, not an addition.
export function computeVersusDeal(
  deal: VersusDeal,
  netCents: number,
  allowedExpensesCents: number,
): DealOutcome {
  // Clamped so a night where expenses beat NBOR gives a share of 0, not a negative one.
  const netAfterExpensesCents = Math.max(0, netCents - allowedExpensesCents);
  const shareCents = applyBps(netAfterExpensesCents, deal.artistShareBps);
  const guaranteeWins = deal.guaranteeCents >= shareCents;
  const dealPayoutCents = guaranteeWins ? deal.guaranteeCents : shareCents;

  return {
    dealPayoutCents,
    lines: [
      guaranteeLine(deal),
      {
        kind: "net_after_expenses",
        label: "NBOR less allowed expenses",
        amountCents: netAfterExpensesCents,
        clauseRef: deal.clauseRef,
        sourceRefs: [],
      },
      {
        kind: "percentage_share",
        label: "Artist share of NBOR less expenses",
        amountCents: shareCents,
        clauseRef: deal.clauseRef,
        sourceRefs: [],
      },
      dealPayoutLine(
        deal,
        guaranteeWins
          ? "Deal payout: the guarantee is higher"
          : "Deal payout: the percentage is higher",
        dealPayoutCents,
      ),
    ],
  };
}

// Payout = guarantee + share of the NBOR above the split point. The split point
// lets the promoter first recover expenses, pay the guarantee and keep a profit.
export function computeGuaranteePlusDeal(
  deal: GuaranteePlusDeal,
  netCents: number,
  allowedExpensesCents: number,
): DealOutcome {
  const promoterProfitCents = applyBps(
    allowedExpensesCents + deal.guaranteeCents,
    deal.promoterProfitBps,
  );
  const splitPointCents = allowedExpensesCents + deal.guaranteeCents + promoterProfitCents;
  const overageCents = Math.max(0, netCents - splitPointCents);
  const shareCents = applyBps(overageCents, deal.artistShareBps);
  const dealPayoutCents = deal.guaranteeCents + shareCents;

  return {
    dealPayoutCents,
    lines: [
      guaranteeLine(deal),
      {
        kind: "promoter_profit",
        label: "Promoter profit on expenses and guarantee",
        amountCents: promoterProfitCents,
        clauseRef: deal.clauseRef,
        sourceRefs: [],
      },
      {
        kind: "split_point",
        label: "Split point (expenses + guarantee + promoter profit)",
        amountCents: splitPointCents,
        clauseRef: deal.clauseRef,
        sourceRefs: [],
      },
      {
        kind: "overage",
        label: "NBOR above the split point",
        amountCents: overageCents,
        clauseRef: deal.clauseRef,
        sourceRefs: [],
      },
      {
        kind: "percentage_share",
        label: "Artist share of the overage",
        amountCents: shareCents,
        clauseRef: deal.clauseRef,
        sourceRefs: [],
      },
      dealPayoutLine(deal, "Deal payout: guarantee plus share of the overage", dealPayoutCents),
    ],
  };
}

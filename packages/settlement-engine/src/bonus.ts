import type { BonusPlan, SettlementLine, SourceRef } from "@ledgerline/schemas";

// Bonus tiers (docs/domain.md §8, rule R7). Each paid tier is its own line, on
// top of the deal payout.
export interface BonusOutcome {
  bonusCents: number;
  lines: SettlementLine[];
}

export function computeBonus(
  plan: BonusPlan | null,
  paidTickets: number,
  ticketSaleRefs: SourceRef[],
): BonusOutcome {
  if (plan === null) {
    return { bonusCents: 0, lines: [] };
  }

  // A tier is reached at ≥ its threshold. filter() returns a new array, so the
  // sort below never reorders the caller's tiers.
  const tiersReached = plan.tiers
    .filter((tier) => paidTickets >= tier.minTicketsSold)
    .sort((a, b) => a.minTicketsSold - b.minTicketsSold);

  // Highest-only pays just the last (highest) tier reached; slice(-1) of an
  // empty array is empty, so "no tier reached" needs no special case.
  const tiersPaid = plan.mode === "cumulative" ? tiersReached : tiersReached.slice(-1);

  let bonusCents = 0;
  const lines: SettlementLine[] = [];
  for (const tier of tiersPaid) {
    bonusCents += tier.bonusCents;
    lines.push({
      kind: "bonus",
      label: `Bonus: ${tier.minTicketsSold}+ paid tickets`,
      amountCents: tier.bonusCents,
      clauseRef: plan.clauseRef,
      sourceRefs: [...ticketSaleRefs], // a copy per line, so lines never share an array
    });
  }

  return { bonusCents, lines };
}

import type { SettlementLine, SourceRef, TicketSale } from "@ledgerline/schemas";

// Ticket revenue (docs/domain.md §2, rules R1 and R2).
export interface BoxOffice {
  grossCents: number; // GBOR
  netCents: number; // NBOR
  paidTickets: number; // comps excluded; bonus tiers count these
  lines: SettlementLine[];
}

export function ticketSaleRefs(ticketSales: readonly TicketSale[]): SourceRef[] {
  return ticketSales.map((sale) => ({ type: "ticket_sale", id: sale.id }));
}

export function computeBoxOffice(ticketSales: readonly TicketSale[]): BoxOffice {
  let grossCents = 0;
  let taxCents = 0;
  let feeCents = 0;
  let paidTickets = 0;

  for (const sale of ticketSales) {
    // qtySold is paid tickets only, so comps add nothing here.
    grossCents += sale.qtySold * sale.priceCents;
    taxCents += sale.taxCents;
    feeCents += sale.feeCents;
    paidTickets += sale.qtySold;
  }

  // Never negative: the schema checks tax + fees ≤ gross for every tier.
  const netCents = grossCents - taxCents - feeCents;

  return {
    grossCents,
    netCents,
    paidTickets,
    lines: [
      {
        kind: "gbor",
        label: "Gross box office receipts (GBOR)",
        amountCents: grossCents,
        clauseRef: null,
        sourceRefs: ticketSaleRefs(ticketSales),
      },
      {
        kind: "ticket_tax",
        label: "Less: ticket taxes",
        amountCents: taxCents,
        clauseRef: null,
        sourceRefs: ticketSaleRefs(ticketSales),
      },
      {
        kind: "ticket_fees",
        label: "Less: deductible ticketing fees",
        amountCents: feeCents,
        clauseRef: null,
        sourceRefs: ticketSaleRefs(ticketSales),
      },
      {
        kind: "nbor",
        label: "Net box office receipts (NBOR)",
        amountCents: netCents,
        clauseRef: null,
        sourceRefs: ticketSaleRefs(ticketSales),
      },
    ],
  };
}

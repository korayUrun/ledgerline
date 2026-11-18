import {
  SettlementInputSchema,
  type SettlementInput,
  type SettlementLine,
  type SettlementResult,
} from "@ledgerline/schemas";
import { computeBonus } from "./bonus.js";
import { computeBoxOffice, ticketSaleRefs } from "./box-office.js";
import {
  computeFlatDeal,
  computeGuaranteePlusDeal,
  computePercentageDeal,
  computeVersusDeal,
  type DealOutcome,
} from "./deals.js";
import { computeAllowedExpenses } from "./expenses.js";

// The whole pipeline (docs/SYSTEM.md §6): box office → expenses → deal → bonus → total.
// Pure and synchronous: the same input always gives the same result.
export function computeSettlement(input: SettlementInput): SettlementResult {
  // Parsed again even though the type says it is valid: a cast, a JSON file or
  // a JavaScript caller can bypass the type, and this is the code that decides
  // how much money moves. Throws a ZodError on invalid input.
  const { terms, ticketSales, expenses } = SettlementInputSchema.parse(input);

  const boxOffice = computeBoxOffice(ticketSales);
  const lines: SettlementLine[] = [...boxOffice.lines];

  // Only versus and guarantee plus deduct expenses, so only they get expense lines.
  const deal = terms.deal;
  let dealOutcome: DealOutcome;
  switch (deal.type) {
    case "flat":
      dealOutcome = computeFlatDeal(deal);
      break;
    case "percentage":
      dealOutcome = computePercentageDeal(deal, boxOffice.netCents);
      break;
    case "versus": {
      const allowed = computeAllowedExpenses(expenses, terms.expensePolicy);
      lines.push(...allowed.lines);
      dealOutcome = computeVersusDeal(deal, boxOffice.netCents, allowed.allowedCents);
      break;
    }
    case "guarantee_plus": {
      const allowed = computeAllowedExpenses(expenses, terms.expensePolicy);
      lines.push(...allowed.lines);
      dealOutcome = computeGuaranteePlusDeal(deal, boxOffice.netCents, allowed.allowedCents);
      break;
    }
  }
  lines.push(...dealOutcome.lines);

  const bonus = computeBonus(terms.bonus, boxOffice.paidTickets, ticketSaleRefs(ticketSales));
  lines.push(...bonus.lines);

  const payoutCents = dealOutcome.dealPayoutCents + bonus.bonusCents;
  lines.push({
    kind: "total_payout",
    label: "Total artist payout",
    amountCents: payoutCents,
    clauseRef: null,
    sourceRefs: [],
  });

  return { payoutCents, lines };
}

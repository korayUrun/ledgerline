import {
  formatBps,
  formatCents,
  hasEvidence,
  type BonusPlan,
  type ContractExtraction,
  type ContractTerms,
  type Deal,
  type Evidence,
  type ExpensePolicy,
  type SettlementInput,
  type SettlementLine,
  type V1Clause,
  type V1LineExplanation,
} from "@ledgerline/schemas";
import { toMoney } from "./v1-response.js";

// What explains one worksheet line (GET /v1/settlements/:id/lines/:position).
// Pure: no database, no LLM. It only gathers facts the engine already recorded:
//   - the input rows the line was computed from (its sourceRefs, looked up in the
//     frozen inputSnapshot, so they are the rows the engine saw, not today's);
//   - the part of the confirmed terms its clauseRef points to, with the contract's
//     own words for them when the terms were confirmed from an extracted PDF.
// The explaining in sentences is left to the client (e.g. Claude through MCP): the
// code collects the facts, the language model reads and quotes them.

export type LineExplanationInput = {
  lines: SettlementLine[];
  snapshot: SettlementInput; // Settlement.inputSnapshot
  // Live descriptions of the expenses (the engine input has no descriptions).
  descriptions: Map<string, string>;
  extraction: ContractExtraction | null; // null = terms typed in by hand
};

export type LineFacts = Omit<V1LineExplanation, "settlementId" | "settlementVersion">;

// null = there is no line at this position.
export function explainLine(input: LineExplanationInput, position: number): LineFacts | null {
  const line = input.lines[position];
  if (!line) {
    return null;
  }
  const salesById = new Map(input.snapshot.ticketSales.map((sale) => [sale.id, sale]));
  const expensesById = new Map(input.snapshot.expenses.map((expense) => [expense.id, expense]));
  // The engine wrote these refs from the same snapshot, so every id is there. A
  // missing one means the stored lines and snapshot disagree: a bug, so it throws.
  const lookUp = <T>(byId: Map<string, T>, id: string): T => {
    const row = byId.get(id);
    if (!row) throw new Error(`Line ${position} points to ${id}, which is not in the snapshot`);
    return row;
  };

  return {
    line: {
      position,
      kind: line.kind,
      label: line.label,
      amount: toMoney(line.amountCents),
      clauseRef: line.clauseRef,
    },
    ticketSales: line.sourceRefs
      .filter((ref) => ref.type === "ticket_sale")
      .map((ref) => {
        const sale = lookUp(salesById, ref.id);
        return {
          id: sale.id,
          tierName: sale.tierName,
          qtySold: sale.qtySold,
          comps: sale.comps,
          price: toMoney(sale.priceCents),
          tax: toMoney(sale.taxCents),
          fees: toMoney(sale.feeCents),
        };
      }),
    expenses: line.sourceRefs
      .filter((ref) => ref.type === "expense")
      .map((ref) => {
        const expense = lookUp(expensesById, ref.id);
        return {
          id: expense.id,
          category: expense.category,
          description: input.descriptions.get(expense.id) ?? null,
          amount: toMoney(expense.amountCents),
          status: expense.status,
        };
      }),
    clauses:
      line.clauseRef === null
        ? []
        : clausesFor(line.clauseRef, input.snapshot.terms, input.extraction),
  };
}

// Every section of the terms with this clauseRef. Usually one, but a contract may put
// the deal and the expense policy under the same section number.
function clausesFor(
  clauseRef: string,
  terms: ContractTerms,
  extraction: ContractExtraction | null,
): V1Clause[] {
  const clauses: V1Clause[] = [];
  if (terms.deal.clauseRef === clauseRef) {
    clauses.push({
      ref: clauseRef,
      section: "deal",
      terms: dealTerms(terms.deal),
      quotes: extraction ? dealQuotes(extraction) : [],
    });
  }
  if (terms.expensePolicy.clauseRef === clauseRef) {
    clauses.push({
      ref: clauseRef,
      section: "expense_policy",
      terms: expensePolicyTerms(terms.expensePolicy),
      quotes: extraction ? expensePolicyQuotes(extraction) : [],
    });
  }
  if (terms.bonus !== null && terms.bonus.clauseRef === clauseRef) {
    clauses.push({
      ref: clauseRef,
      section: "bonus",
      terms: bonusTerms(terms.bonus),
      quotes: extraction ? bonusQuotes(extraction) : [],
    });
  }
  return clauses;
}

type Term = V1Clause["terms"][number];

// One case per deal type, each with only the terms that type has.
function dealTerms(deal: Deal): Term[] {
  const type = { name: "deal type", value: deal.type };
  switch (deal.type) {
    case "flat":
      return [type, { name: "guarantee", value: formatCents(deal.guaranteeCents) }];
    case "percentage":
      return [type, { name: "artist share", value: formatBps(deal.artistShareBps) }];
    case "versus":
      return [
        type,
        { name: "guarantee", value: formatCents(deal.guaranteeCents) },
        { name: "artist share", value: formatBps(deal.artistShareBps) },
      ];
    case "guarantee_plus":
      return [
        type,
        { name: "guarantee", value: formatCents(deal.guaranteeCents) },
        { name: "artist share", value: formatBps(deal.artistShareBps) },
        { name: "promoter profit", value: formatBps(deal.promoterProfitBps) },
      ];
  }
}

function expensePolicyTerms(policy: ExpensePolicy): Term[] {
  return [
    { name: "allowed categories", value: policy.allowedCategories.join(", ") || "none" },
    ...policy.categoryCaps.map((cap) => ({
      name: `cap on ${cap.category}`,
      value: formatCents(cap.capCents),
    })),
    {
      name: "total cap",
      value: policy.totalCapCents === null ? "none" : formatCents(policy.totalCapCents),
    },
  ];
}

function bonusTerms(bonus: BonusPlan): Term[] {
  return [
    { name: "bonus mode", value: bonus.mode },
    ...bonus.tiers.map((tier) => ({
      name: `bonus at ${tier.minTicketsSold}+ paid tickets`,
      value: formatCents(tier.bonusCents),
    })),
  ];
}

function dealQuotes(extraction: ContractExtraction) {
  const { deal } = extraction;
  return quotes([
    deal.type.evidence,
    deal.guarantee.evidence,
    deal.artistShare.evidence,
    deal.promoterProfit.evidence,
  ]);
}

function expensePolicyQuotes(extraction: ContractExtraction) {
  const policy = extraction.expensePolicy;
  return quotes([
    policy.allowedCategories.evidence,
    ...policy.categoryCaps.map((cap) => cap.evidence),
    policy.totalCap.evidence,
  ]);
}

function bonusQuotes(extraction: ContractExtraction) {
  const { bonus } = extraction;
  if (bonus === null) {
    return [];
  }
  return quotes([bonus.mode.evidence, ...bonus.tiers.map((tier) => tier.evidence)]);
}

// Non-empty quotes, each once: one sentence often states two terms ("a guarantee of
// $5,000 versus 85% of net").
function quotes(evidence: Evidence[]): V1Clause["quotes"] {
  const seen = new Set<string>();
  const result: V1Clause["quotes"] = [];
  for (const item of evidence) {
    const key = `${item.page}:${item.quote}`;
    if (hasEvidence(item) && !seen.has(key)) {
      seen.add(key);
      result.push({ text: item.quote, page: item.page });
    }
  }
  return result;
}

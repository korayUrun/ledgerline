import type { ContractExtraction } from "@ledgerline/schemas";

// An extraction where the contract stated nothing: every value null. What the
// offline fake LLM returns, so the review screen opens with every field "missing".
export function nothingFoundExtraction(): ContractExtraction {
  const missing = { value: null, evidence: null };
  return {
    deal: {
      type: missing,
      guarantee: missing,
      artistShare: missing,
      promoterProfit: missing,
      clauseRef: missing,
    },
    expensePolicy: {
      allowedCategories: missing,
      categoryCaps: [],
      totalCap: missing,
      clauseRef: missing,
    },
    bonus: null,
  };
}

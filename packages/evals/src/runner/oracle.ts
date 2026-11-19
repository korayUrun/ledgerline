import { FakeLlmClient, fakeTextMessage, type LlmClient } from "@ledgerline/api";
import {
  formatBps,
  formatCents,
  NO_EVIDENCE,
  type ContractExtraction,
  type ContractTerms,
} from "@ledgerline/schemas";

// A fake Claude that always answers with the ground truth, written the way the
// real model is asked to write it (amounts as "$12,500.00", percentages as "85%").
//
// It measures nothing about the model. It tests the eval pipeline itself: if the
// oracle does not score 100% field accuracy and 100% payout exactness, the bug is
// in the scoring, the conversions or the dataset, not in Claude.
export function oracleClient(truth: ContractTerms): LlmClient {
  return new FakeLlmClient(() =>
    fakeTextMessage(JSON.stringify(termsToExtraction(truth)), {
      model: "oracle",
      inputTokens: 0,
      outputTokens: 0,
    }),
  );
}

export function termsToExtraction(terms: ContractTerms): ContractExtraction {
  const evidence = { quote: "(oracle: ground truth)", page: 1 };
  const found = <T>(value: T) => ({ value, evidence });
  const missing = { value: null, evidence: NO_EVIDENCE };
  const { deal, expensePolicy, bonus } = terms;
  return {
    deal: {
      type: found(deal.type),
      guarantee: "guaranteeCents" in deal ? found(formatCents(deal.guaranteeCents)) : missing,
      artistShare: "artistShareBps" in deal ? found(formatBps(deal.artistShareBps)) : missing,
      promoterProfit:
        deal.type === "guarantee_plus" ? found(formatBps(deal.promoterProfitBps)) : missing,
      clauseRef: found(deal.clauseRef),
    },
    expensePolicy: {
      allowedCategories: found(expensePolicy.allowedCategories),
      categoryCaps: expensePolicy.categoryCaps.map((cap) => ({
        category: cap.category,
        cap: formatCents(cap.capCents),
        evidence,
      })),
      totalCap:
        expensePolicy.totalCapCents === null
          ? missing
          : found(formatCents(expensePolicy.totalCapCents)),
      clauseRef: found(expensePolicy.clauseRef),
    },
    bonus: bonus && {
      mode: found(bonus.mode),
      tiers: bonus.tiers.map((tier) => ({
        minTicketsSold: tier.minTicketsSold,
        bonus: formatCents(tier.bonusCents),
        evidence,
      })),
      clauseRef: found(bonus.clauseRef),
    },
  };
}

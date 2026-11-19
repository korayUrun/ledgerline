# Extraction eval: 2026-11-19

Mode **live** · model `claude-opus-5-5` · prompt `extract-v2` · 25 contracts

## Summary

| Metric | Value |
|---|---|
| Field accuracy (all fields) | 100.0% (300/300) |
| Payout exactness (to the cent) | 100.0% (25/25) |
| Extraction failures | 0 |
| Retries (extra calls) | 0 |
| Tokens in / out | 181,836 / 16,041 |
| Cost total / per contract | $1.0482 / $0.0419 |
| Average time per contract | 5.8 s |

## Accuracy per field

Missed = the contract states it, the extraction returned null. Invented = the extraction returned a value the contract does not have.

| Field | Accuracy | Correct | Wrong | Missed | Invented |
|---|---|---|---|---|---|
| `deal.type` | 100.0% | 25 | 0 | 0 | 0 |
| `deal.guaranteeCents` | 100.0% | 25 | 0 | 0 | 0 |
| `deal.artistShareBps` | 100.0% | 25 | 0 | 0 | 0 |
| `deal.promoterProfitBps` | 100.0% | 25 | 0 | 0 | 0 |
| `deal.clauseRef` | 100.0% | 25 | 0 | 0 | 0 |
| `expensePolicy.allowedCategories` | 100.0% | 25 | 0 | 0 | 0 |
| `expensePolicy.categoryCaps` | 100.0% | 25 | 0 | 0 | 0 |
| `expensePolicy.totalCapCents` | 100.0% | 25 | 0 | 0 | 0 |
| `expensePolicy.clauseRef` | 100.0% | 25 | 0 | 0 | 0 |
| `bonus.mode` | 100.0% | 25 | 0 | 0 | 0 |
| `bonus.tiers` | 100.0% | 25 | 0 | 0 | 0 |
| `bonus.clauseRef` | 100.0% | 25 | 0 | 0 | 0 |

## Payout exactness by hard feature

| Tag | Cases | Payout exact |
|---|---|---|
| cents_in_guarantee | 3 | 3/3 |
| deposit_distractor | 15 | 15/15 |
| merch_percent_distractor | 14 | 14/14 |
| money_in_words | 7 | 7/7 |
| no_total_cap | 3 | 3/3 |
| prompt_injection | 2 | 2/2 |
| sub_clauses | 19 | 19/19 |

## Cases with errors

None: every field and every payout matched.

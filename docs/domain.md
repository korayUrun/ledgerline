# Ledgerline — Domain Guide

How a live-music settlement works, explained with one synthetic show worked through every deal type. Every number is in **integer cents** and every percentage in **basis points** (bps, 8500 = 85.00%), exactly as the engine will see them. Dollar amounts are shown next to the cents to make them easy to read.

These worked examples become the first unit tests of `packages/settlement-engine` in Phase 1.

---

## 0. Glossary

| Term | Meaning |
|------|---------|
| **Settlement** | The end-of-night calculation of what the venue (promoter) owes the artist. |
| **Promoter** | The party that rents or runs the venue, pays the costs and takes the risk. In Ledgerline, the venue organization. |
| **Face value** | The ticket price printed on the ticket, before any service fee the buyer pays on top. |
| **Comp** | A complimentary (free) ticket. It fills a seat but brings in no money. |
| **GBOR** | Gross box office receipts: all ticket money at face value. |
| **NBOR** | Net box office receipts: GBOR minus taxes and deductible ticketing fees. |
| **Guarantee** | A fixed amount the artist is promised, however many tickets sell. |
| **Allowed expenses** | Show costs the contract lets the promoter deduct before sharing the upside. |
| **Promoter profit** | In a guarantee-plus deal: a margin the promoter keeps before the artist shares the upside. |
| **Split point** | In a guarantee-plus deal: the NBOR level above which the artist shares the money. |
| **Overage** | NBOR above the split point. |
| **Bonus tier** | An extra fixed amount paid when ticket sales reach a threshold. |

---

## 1. The example show

**The Lanterns at Hall 9.** A synthetic show used in every section below.

The contract allows these expense categories: **production, advertising, catering, security**. Advertising is capped at **$1,500 (150,000)**. Total expenses are capped at **$6,000 (600,000)**.

There are two versions of the night, so each deal can be seen both when things go well and when they don't:
- **Strong night:** 500 paid tickets.
- **Weak night:** 310 paid tickets.

Expenses are the same on both nights.

---

## 2. GBOR vs NBOR

**Rules**
- `GBOR = Σ qtySold × priceCents` across all tiers.
- `NBOR = GBOR − Σ taxCents − Σ feeCents`.
- `qtySold` counts **paid tickets only**. Comps are stored separately and add nothing to GBOR.
- `priceCents` is face value. A service fee the buyer pays on top never reaches the box office, so it is not in GBOR.
- `taxCents` and `feeCents` are tier totals of the tax and deductible fees **contained in** that tier's gross. That is why they are subtracted.

**Strong night**

| Tier | qtySold | Comps | priceCents | Gross | taxCents | feeCents |
|------|--------:|------:|-----------:|------:|---------:|---------:|
| GA | 400 | 20 | 3,500 | 1,400,000 | 112,000 | 40,000 |
| VIP | 100 | 5 | 7,500 | 750,000 | 60,000 | 10,000 |
| **Total** | **500** | 25 | | **2,150,000** | **172,000** | **50,000** |

- GBOR = 1,400,000 + 750,000 = **2,150,000** ($21,500.00)
- NBOR = 2,150,000 − 172,000 − 50,000 = **1,928,000** ($19,280.00)
- The 25 comps change nothing. Counting them as `(qtySold − comps)` would wrongly remove 25 *paid* tickets' worth of revenue.

**Weak night**

| Tier | qtySold | Comps | priceCents | Gross | taxCents | feeCents |
|------|--------:|------:|-----------:|------:|---------:|---------:|
| GA | 250 | 30 | 3,500 | 875,000 | 70,000 | 25,000 |
| VIP | 60 | 10 | 7,500 | 450,000 | 36,000 | 6,000 |
| **Total** | **310** | 40 | | **1,325,000** | **106,000** | **31,000** |

- GBOR = **1,325,000** ($13,250.00)
- NBOR = 1,325,000 − 106,000 − 31,000 = **1,188,000** ($11,880.00)

---

## 3. Expenses and caps

**Rules.** The steps are applied in this order, and the order is part of the rule:
1. **Filter:** drop expenses whose category the contract does not allow, and expenses a reviewer marked `disallowed`.
2. **Category caps:** reduce each capped category to its cap.
3. **Total cap:** if the sum is still above the total expense cap, reduce it to the cap.

**Example** (the same on both nights)

| Category | Submitted | Step 1: filter | Step 2: category cap | Notes |
|----------|----------:|---------------:|---------------------:|-------|
| production | 280,000 | 280,000 | 280,000 | |
| advertising | 190,000 | 190,000 | **150,000** | capped at 150,000 |
| catering | 90,000 | 90,000 | 90,000 | |
| security | 120,000 | 120,000 | 120,000 | |
| office_supplies | 30,000 | **0** | 0 | category not in the contract |
| **Sum** | 710,000 | **680,000** | **640,000** | |

Step 3: 640,000 > 600,000, so **allowedExpenses = 600,000** ($6,000.00).

**Why the order matters.** If the total cap were applied first (680,000 → 600,000) and the advertising excess of 40,000 were removed afterwards, the result would be 560,000. That is $400 different from the same inputs. The engine must always apply the steps in order 1 → 2 → 3, and the worksheet shows one line per step, so a reader can see where each dollar went.

---

## 4. Flat guarantee

**Rule:** `payout = guarantee`. Ticket sales and expenses do not change it.

**Terms:** guarantee **1,000,000** ($10,000.00).

| Night | Payout |
|-------|-------:|
| Strong | **1,000,000** |
| Weak | **1,000,000** |

The promoter takes all the risk and keeps all the upside.

---

## 5. Percentage of NBOR

**Rule:** `payout = roundHalfUp(NBOR × pctBps / 10000)`. There is no guarantee, and expenses are not deducted.

**Terms:** 6000 bps (60%) of NBOR.

| Night | NBOR | Payout |
|-------|-----:|-------:|
| Strong | 1,928,000 | 1,928,000 × 6000 / 10000 = **1,156,800** ($11,568.00) |
| Weak | 1,188,000 | 1,188,000 × 6000 / 10000 = **712,800** ($7,128.00) |

Here the artist shares both the risk and the upside.

---

## 6. Versus (guarantee vs percentage)

**Rule:** `payout = max(guarantee, roundHalfUp(max(0, NBOR − allowedExpenses) × pctBps / 10000))`.

The artist gets **whichever is larger**: the guarantee or the percentage of the net after expenses. The guarantee is a floor, not an addition. The inner `max(0, …)` keeps the percentage line from going negative when expenses are larger than NBOR.

**Terms:** guarantee 1,000,000 ($10,000) versus 8500 bps (85%) of (NBOR − allowed expenses).

**Strong night: the percentage wins**
- NBOR − expenses = 1,928,000 − 600,000 = 1,328,000
- 85% share = 1,328,000 × 8500 / 10000 = 1,128,800
- payout = max(1,000,000, 1,128,800) = **1,128,800** ($11,288.00)
- Promoter keeps 1,928,000 − 600,000 − 1,128,800 = 199,200

**Weak night: the guarantee wins**
- NBOR − expenses = 1,188,000 − 600,000 = 588,000
- 85% share = 588,000 × 8500 / 10000 = 499,800
- payout = max(1,000,000, 499,800) = **1,000,000** ($10,000.00)
- Promoter result: 1,188,000 − 600,000 − 1,000,000 = **−412,000**. The promoter loses $4,120. That loss is the price of offering a guarantee.

**Break-even.** The percentage starts to win when 85% × (NBOR − 600,000) > 1,000,000, which means NBOR is above about **1,776,471** ($17,764.71).

---

## 7. Guarantee plus (guarantee plus a split)

**Rules**
- `promoterProfit = roundHalfUp((allowedExpenses + guarantee) × promoterProfitBps / 10000)`
- `splitPoint = allowedExpenses + guarantee + promoterProfit`
- `overage = max(0, NBOR − splitPoint)`
- `payout = guarantee + roundHalfUp(overage × pctBps / 10000)`

The artist gets the guarantee **and also** a share of the money above the split point. The split point is higher than in a versus deal, though: the promoter first recovers expenses, pays the guarantee and keeps an agreed profit.

**Terms:** guarantee 1,000,000 ($10,000), promoter profit 1500 bps (15%) of (expenses + guarantee), and the artist gets 8500 bps (85%) of the overage.

The split point is the same on both nights because expenses and guarantee are the same:
- promoterProfit = (600,000 + 1,000,000) × 1500 / 10000 = **240,000** ($2,400.00)
- splitPoint = 600,000 + 1,000,000 + 240,000 = **1,840,000** ($18,400.00)

**Strong night: above the split point**
- overage = 1,928,000 − 1,840,000 = 88,000
- artist share = 88,000 × 8500 / 10000 = 74,800
- payout = 1,000,000 + 74,800 = **1,074,800** ($10,748.00)

**Weak night: below the split point**
- overage = max(0, 1,188,000 − 1,840,000) = 0
- payout = 1,000,000 + 0 = **1,000,000** ($10,000.00)

---

## 8. Bonus tiers

**Rules**
- Tiers are based on **paid tickets sold** (`Σ qtySold`, comps excluded). A tier is reached when tickets sold ≥ its threshold.
- **Cumulative:** the artist gets every tier reached, added together.
- **Highest-only:** the artist gets only the highest tier reached. A higher tier must not pay less than a lower one; otherwise selling one more ticket could lower the payout, so the schema rejects such a plan.
- The bonus is added **on top of** the deal payout as its own line.

**Terms**

| Threshold (tickets) | Bonus |
|--------------------:|------:|
| 400 | 50,000 ($500) |
| 450 | 75,000 ($750) |
| 550 | 100,000 ($1,000) |

| Night | Tickets | Tiers reached | Cumulative | Highest-only |
|-------|--------:|---------------|-----------:|-------------:|
| Strong | 500 | 400, 450 | 50,000 + 75,000 = **125,000** | **75,000** |
| Weak | 310 | none | **0** | **0** |

On the strong night, versus with a cumulative bonus pays 1,128,800 + 125,000 = **1,253,800** ($12,538.00).

The 25 comps do not count. If they did, the strong night would show 525 tickets. That is still below 550, but near a threshold, comps could unlock a bonus nobody paid for.

---

## 9. Rounding

**Rule:** a percentage of an amount is `roundHalfUp(amount × bps / 10000)`.
- `amount × bps` is always an exact integer, so the only question is the remainder after dividing by 10,000: below 5,000 rounds down, and 5,000 or more rounds up.
- Rounding happens **once per line**, on that line's own total. It never happens on intermediate rows that are summed later.
- Amounts are clamped to ≥ 0 before a percentage is taken, so half-up never has to decide what to do with negatives.
- `Number` holds integers exactly up to 2^53 ≈ 9 × 10^15. The largest product here is 10^9 cents ($10M) × 10,000 bps = 10^13, which is well inside that range.

**Example 1: a normal case.** 85% of 1,234,567:
- 1,234,567 × 8500 = 10,493,819,500
- ÷ 10,000 = 1,049,381 remainder 9,500 → rounds up to **1,049,382**

**Example 2: the exact half.** 85% of 1,234,510:
- 1,234,510 × 8500 = 10,493,335,000
- ÷ 10,000 = 1,049,333 remainder 5,000 → exactly half, so half-up gives **1,049,334**
- Banker's rounding (half to even) would give 1,049,334 here too, but on 1,049,334.5 it would round *down*. The rule must name one method, and the tests must pin it.

**Example 3: why "once per line" matters.** Suppose the 85% share were computed per tier and then summed:

| | Amount | 85% exact | Rounded |
|--|------:|----------:|--------:|
| Tier A | 1,234,510 | 1,049,333.5 | 1,049,334 |
| Tier B | 765,510 | 650,683.5 | 650,684 |
| Sum of rounded rows | | | **1,700,018** |
| Once on the total, 2,000,020 | | 1,700,017.0 | **1,700,017** |

Rounding per row overpays by 1 cent. One cent is small, but the worksheet would no longer reconcile with the contract, and a property test (`sum of lines = payout`) would catch it. The engine rounds once, on the line the contract defines.

---

## 10. Versus vs guarantee plus: which pays the artist more?

Use the same guarantee `G`, artist share `p` and expenses `E` in both deals. NBOR is `N`.

| NBOR range | Versus | Guarantee plus |
|------------|--------|----------------|
| Low: the percentage loses in versus, and N is below the split point | G | G |
| Middle: the percentage already wins in versus, but N is still below the split point | p × (N − E) > G | G |
| High: both deals are in their upside | p × (N − E) | G + p × (N − E − G − PP) |

- **Low sales:** both deals pay the guarantee.
- **Middle band:** versus pays more. The guarantee-plus artist is still waiting for the promoter to recover the guarantee and profit.
- **High sales:** subtract the two formulas and you get `plus − versus = G × (1 − p) − p × PP`.
  - The guarantee-plus artist keeps the *whole* guarantee on top of the share. In versus, the guarantee is "eaten" by the percentage, so this term is a gain for guarantee plus.
  - The guarantee-plus artist pays for the promoter's profit, PP, out of their share. That term is a loss for guarantee plus.
  - **Guarantee plus wins at high sales only if `PP < G × (1 − p) / p`.**

**With our numbers** (G = 1,000,000, p = 85%, E = 600,000): the threshold is PP < 1,000,000 × 0.15 / 0.85 ≈ **176,471**.

| NBOR | Versus | Plus, PP 15% = 240,000 | Plus, PP 10% = 160,000 |
|-----:|-------:|-----------------------:|-----------------------:|
| 1,700,000 | 1,000,000 | 1,000,000 | 1,000,000 |
| 1,800,000 | 1,020,000 | 1,000,000 | 1,034,000 |
| 1,928,000 (strong) | 1,128,800 | 1,074,800 | **1,142,800** |
| 2,500,000 | 1,615,000 | 1,561,000 | **1,629,000** |

- **PP 15% (240,000 > 176,471):** versus is always at least as good for the artist. At high sales the gap is fixed at 150,000 − 204,000 = **−54,000**.
- **PP 10% (160,000 < 176,471):** guarantee plus wins once N is above its split point (1,760,000), by a fixed **+14,000** at high sales.

**In one sentence:** in versus the guarantee is a *floor* the percentage can replace; in guarantee plus it is a *base* the percentage adds to, but only after the promoter has taken a profit. The artist prefers guarantee plus when that promoter profit is small compared with the guarantee.

---

## 11. Self-check exercises

Work these out by hand before opening the answers. Unless an exercise says otherwise, use the strong night (NBOR 1,928,000, allowed expenses 600,000, 500 tickets).

1. **Versus:** guarantee 1,200,000 vs 9000 bps of (NBOR − expenses). What is the payout, and which side wins?
2. **Guarantee plus:** guarantee 800,000, promoter profit 2000 bps, artist share 9000 bps. Give the promoter profit, split point, overage and payout.
3. **Rounding:** 7000 bps of 1,234,565.
4. **Expenses:** if the total cap were 700,000 instead of 600,000, what would allowed expenses be?
5. **Bonus:** under highest-only, what is the bonus if 455 paid tickets and 100 comps were issued?

<details>
<summary>Answers</summary>

1. 1,328,000 × 9000 / 10000 = 1,195,200 < 1,200,000, so the **guarantee wins: 1,200,000**.
2. Promoter profit = 1,400,000 × 2000 / 10000 = **280,000**. Split point = 600,000 + 800,000 + 280,000 = **1,680,000**. Overage = 1,928,000 − 1,680,000 = **248,000**. Share = 248,000 × 9000 / 10000 = 223,200. **Payout = 1,023,200**.
3. 1,234,565 × 7000 = 8,641,955,000. ÷ 10,000 = 864,195 remainder 5,000 → half-up → **864,196**.
4. After category caps the total is 640,000, which is below 700,000. The total cap does not bind, so the answer is **640,000**.
5. Comps don't count, so tickets sold = 455. That reaches the 400 and 450 tiers, and the highest is **75,000**.

</details>

---

## 12. Rules the engine must follow (summary)

| # | Rule |
|---|------|
| R1 | GBOR = Σ qtySold × priceCents, where qtySold excludes comps. |
| R2 | NBOR = GBOR − Σ taxCents − Σ feeCents. |
| R3 | Expenses: filter → category caps → total cap, in that order. |
| R4 | Percentages: `roundHalfUp(amount × bps / 10000)`, once per line, on amounts clamped to ≥ 0. |
| R5 | Versus: max(guarantee, pct of max(0, NBOR − expenses)). |
| R6 | Guarantee plus: promoter profit on (expenses + guarantee); split point = expenses + guarantee + promoter profit; payout = guarantee + pct of max(0, NBOR − split point). |
| R7 | Bonus tiers are based on paid tickets, a tier is reached at ≥ threshold, cumulative or highest-only as the contract says (in highest-only, a higher tier never pays less), and the bonus is added on top as its own line. |
| R8 | Every number above is a separate worksheet line with its clause and source rows. |

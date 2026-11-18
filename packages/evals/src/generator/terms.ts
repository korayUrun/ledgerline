import type {
  BonusPlan,
  ContractTerms,
  DealType,
  ExpenseCategory,
  ExpensePolicy,
} from "@ledgerline/schemas";
import type { Rng } from "./random.js";

// Random but realistic deal terms: round guarantees, percentages in 5% or 2.5%
// steps, a few capped categories. These are the ground truth the extractor is
// scored against. clauseRef is filled in later, once the contract text has decided
// which section each clause lands in.

export const PLACEHOLDER_CLAUSE = "§?";

// Categories a contract may allow. office_supplies and other are never allowed, so
// they are what the scenario uses for "expense in a category the contract does not allow".
export const DEDUCTIBLE_CATEGORIES: readonly ExpenseCategory[] = [
  "production",
  "advertising",
  "catering",
  "security",
  "staffing",
  "equipment",
];

const DOLLAR = 100; // cents

// nborCents is the show's net box office. Versus and guarantee-plus guarantees are
// sized from it (20%–70%), so in about half the cases the percentage side wins.
// With a random guarantee the guarantee would nearly always win, and a wrong
// percentage would still give the "exact" payout: the metric would not notice.
export function generateDeal(rng: Rng, type: DealType, nborCents: number): ContractTerms["deal"] {
  const clauseRef = PLACEHOLDER_CLAUSE;
  const scaledGuarantee = () => {
    const cents = Math.max(4, Math.round((nborCents * rng.int(20, 70)) / 100 / 25_000)) * 25_000;
    return rng.chance(0.15) ? cents + rng.int(1, 99) : cents;
  };
  switch (type) {
    case "flat":
      return { type, guaranteeCents: generateGuarantee(rng), clauseRef };
    case "percentage":
      return { type, artistShareBps: rng.int(20, 34) * 250, clauseRef }; // 50%–85%
    case "versus":
      return {
        type,
        guaranteeCents: scaledGuarantee(),
        artistShareBps: rng.int(28, 36) * 250, // 70%–90%
        clauseRef,
      };
    case "guarantee_plus":
      return {
        type,
        guaranteeCents: scaledGuarantee(),
        artistShareBps: rng.int(14, 18) * 500, // 70%–90%
        promoterProfitBps: rng.int(2, 4) * 500, // 10%–20%
        clauseRef,
      };
  }
}

// $1,000–$40,000 in $250 steps; now and then an odd amount with cents, so the
// extractor has to keep the cents ("$7,512.37").
function generateGuarantee(rng: Rng): number {
  const base = rng.int(4, 160) * 250 * DOLLAR;
  return rng.chance(0.15) ? base + rng.int(1, 99) : base;
}

// Flat and percentage deals deduct no expenses: the contract says so in its own
// clause, and the terms record that as an empty policy.
export function generateExpensePolicy(rng: Rng, type: DealType): ExpensePolicy {
  if (type === "flat" || type === "percentage") {
    return {
      allowedCategories: [],
      categoryCaps: [],
      totalCapCents: null,
      clauseRef: PLACEHOLDER_CLAUSE,
    };
  }
  // Keep the canonical order, so the ground truth does not depend on the shuffle.
  const chosen = rng.sample(DEDUCTIBLE_CATEGORIES, rng.int(3, 6));
  const allowedCategories = DEDUCTIBLE_CATEGORIES.filter((category) => chosen.includes(category));
  const categoryCaps = rng
    .sample(allowedCategories, rng.int(0, 2))
    .map((category) => ({ category, capCents: rng.int(2, 12) * 250 * DOLLAR }))
    .sort(
      (a, b) =>
        DEDUCTIBLE_CATEGORIES.indexOf(a.category) - DEDUCTIBLE_CATEGORIES.indexOf(b.category),
    );
  return {
    allowedCategories,
    categoryCaps,
    totalCapCents: rng.chance(0.7) ? rng.int(6, 24) * 500 * DOLLAR : null,
    clauseRef: PLACEHOLDER_CLAUSE,
  };
}

// Thresholds are placed around the tickets actually sold, so some tiers are
// reached and some are not. Bonuses grow with the threshold, which highest-only
// requires (BonusPlanSchema) and which is how real contracts are written anyway.
export function generateBonus(rng: Rng, ticketsSold: number): BonusPlan | null {
  if (rng.chance(0.4)) {
    return null;
  }
  const tierCount = rng.int(1, 3);
  const thresholds = new Set<number>();
  while (thresholds.size < tierCount) {
    const fraction = rng.int(60, 130); // 60%–130% of tickets sold
    thresholds.add(Math.max(50, Math.round((ticketsSold * fraction) / 100 / 50) * 50));
  }
  const sortedThresholds = [...thresholds].sort((a, b) => a - b);
  let bonusCents = 0;
  const tiers = sortedThresholds.map((minTicketsSold) => {
    bonusCents += rng.int(1, 4) * 250 * DOLLAR;
    return { minTicketsSold, bonusCents };
  });
  return {
    mode: rng.chance(0.5) ? "cumulative" : "highest_only",
    tiers,
    clauseRef: PLACEHOLDER_CLAUSE,
  };
}

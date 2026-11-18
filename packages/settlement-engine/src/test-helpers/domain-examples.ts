import type {
  BonusPlan,
  Deal,
  Expense,
  ExpensePolicy,
  SettlementInput,
  TicketSale,
} from "@ledgerline/schemas";

// "The Lanterns at Hall 9" from docs/domain.md, used by the unit tests.
// Every expected number in the tests comes from that document.

export const STRONG_NIGHT_SALES: TicketSale[] = [
  {
    id: "ts-ga",
    tierName: "GA",
    qtySold: 400,
    comps: 20,
    priceCents: 3500,
    taxCents: 112_000,
    feeCents: 40_000,
  },
  {
    id: "ts-vip",
    tierName: "VIP",
    qtySold: 100,
    comps: 5,
    priceCents: 7500,
    taxCents: 60_000,
    feeCents: 10_000,
  },
];

export const WEAK_NIGHT_SALES: TicketSale[] = [
  {
    id: "ts-ga",
    tierName: "GA",
    qtySold: 250,
    comps: 30,
    priceCents: 3500,
    taxCents: 70_000,
    feeCents: 25_000,
  },
  {
    id: "ts-vip",
    tierName: "VIP",
    qtySold: 60,
    comps: 10,
    priceCents: 7500,
    taxCents: 36_000,
    feeCents: 6_000,
  },
];

export const HALL9_EXPENSES: Expense[] = [
  { id: "ex-production", category: "production", amountCents: 280_000, status: "allowed" },
  { id: "ex-advertising", category: "advertising", amountCents: 190_000, status: "allowed" },
  { id: "ex-catering", category: "catering", amountCents: 90_000, status: "allowed" },
  { id: "ex-security", category: "security", amountCents: 120_000, status: "allowed" },
  { id: "ex-office", category: "office_supplies", amountCents: 30_000, status: "allowed" },
];

export const HALL9_EXPENSE_POLICY: ExpensePolicy = {
  allowedCategories: ["production", "advertising", "catering", "security"],
  categoryCaps: [{ category: "advertising", capCents: 150_000 }],
  totalCapCents: 600_000,
  clauseRef: "§5",
};

export const FLAT_DEAL: Deal = { type: "flat", guaranteeCents: 1_000_000, clauseRef: "§4" };
export const PERCENTAGE_DEAL: Deal = { type: "percentage", artistShareBps: 6000, clauseRef: "§4" };
export const VERSUS_DEAL: Deal = {
  type: "versus",
  guaranteeCents: 1_000_000,
  artistShareBps: 8500,
  clauseRef: "§4",
};
export const GUARANTEE_PLUS_DEAL: Deal = {
  type: "guarantee_plus",
  guaranteeCents: 1_000_000,
  artistShareBps: 8500,
  promoterProfitBps: 1500,
  clauseRef: "§4",
};

export function hall9BonusPlan(mode: BonusPlan["mode"]): BonusPlan {
  return {
    mode,
    tiers: [
      { minTicketsSold: 400, bonusCents: 50_000 },
      { minTicketsSold: 450, bonusCents: 75_000 },
      { minTicketsSold: 550, bonusCents: 100_000 },
    ],
    clauseRef: "§6",
  };
}

export function hall9Input(
  sales: TicketSale[],
  deal: Deal,
  bonus: BonusPlan | null = null,
): SettlementInput {
  return {
    terms: { deal, expensePolicy: HALL9_EXPENSE_POLICY, bonus },
    ticketSales: sales,
    expenses: HALL9_EXPENSES,
  };
}

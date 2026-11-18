import type { ExpenseCategory, ExpensePolicy, TicketSale } from "@ledgerline/schemas";
import { applyBps } from "@ledgerline/settlement-engine";
import type { Rng } from "./random.js";

// Show data that goes with a contract: ticket sales and expenses, with a few
// expenses that break the contract on purpose. Those "planted violations" are the
// ground truth for the audit agent's flags in Phase 4.

export type EvalExpense = {
  id: string;
  category: ExpenseCategory;
  description: string;
  amountCents: number;
  status: "pending"; // nobody has reviewed them yet; the engine still counts them
};

export type PlantedViolation = {
  expenseId: string;
  kind: "category_not_allowed" | "over_category_cap";
};

const DOLLAR = 100;

export function generateTicketSales(rng: Rng): TicketSale[] {
  const gaPriceCents = rng.int(5, 12) * 5 * DOLLAR; // $25–$60
  const tiers = [{ tierName: "GA", priceCents: gaPriceCents, qtySold: rng.int(150, 900) }];
  if (rng.chance(0.7)) {
    const vipPriceCents = gaPriceCents + rng.int(4, 12) * 5 * DOLLAR;
    tiers.push({ tierName: "VIP", priceCents: vipPriceCents, qtySold: rng.int(20, 150) });
  }
  if (rng.chance(0.3)) {
    tiers.push({ tierName: "Balcony", priceCents: gaPriceCents, qtySold: rng.int(30, 200) });
  }

  const taxBps = rng.pick([0, 500, 800, 1000]);
  const feePerTicketCents = rng.pick([100, 150, 200]);
  return tiers.map((tier, index) => {
    const grossCents = tier.qtySold * tier.priceCents;
    return {
      id: `ts-${index + 1}`,
      tierName: tier.tierName,
      qtySold: tier.qtySold,
      comps: rng.int(0, 30),
      priceCents: tier.priceCents,
      // Tax and fees are contained in the gross (docs/domain.md §2).
      taxCents: applyBps(grossCents, taxBps),
      feeCents: tier.qtySold * feePerTicketCents,
    };
  });
}

const DESCRIPTIONS: Record<ExpenseCategory, readonly string[]> = {
  production: ["Sound and lighting rental", "Stage hands and rigging", "Backline rental"],
  advertising: ["Radio spots", "Social media ads", "Poster printing"],
  catering: ["Band dinner and green room", "Crew meals"],
  security: ["Door and floor security", "Barricade security staff"],
  staffing: ["Box office and ushers", "Bar and floor staff"],
  equipment: ["Generator rental", "Video wall rental"],
  office_supplies: ["Printer paper and toner", "Office stationery"],
  other: ["Promoter's parking", "Venue manager's taxi"],
};

export function generateExpenses(
  rng: Rng,
  policy: ExpensePolicy,
): { expenses: EvalExpense[]; plantedViolations: PlantedViolation[] } {
  const expenses: EvalExpense[] = [];
  const plantedViolations: PlantedViolation[] = [];

  function add(category: ExpenseCategory, amountCents: number): string {
    const id = `ex-${expenses.length + 1}`;
    expenses.push({
      id,
      category,
      description: rng.pick(DESCRIPTIONS[category]),
      amountCents,
      status: "pending",
    });
    return id;
  }

  // Flat and percentage deals deduct nothing, so their expenses are only context.
  if (policy.allowedCategories.length === 0) {
    for (const category of rng.sample(["production", "advertising", "catering"] as const, 2)) {
      add(category, rng.int(30, 300) * 10 * DOLLAR);
    }
    return { expenses, plantedViolations };
  }

  for (const category of policy.allowedCategories) {
    const cap = policy.categoryCaps.find((entry) => entry.category === category);
    if (cap) {
      // Over the cap on purpose: the engine caps it, the agent should flag it.
      const id = add(category, cap.capCents + rng.int(1, 20) * 50 * DOLLAR);
      plantedViolations.push({ expenseId: id, kind: "over_category_cap" });
    } else {
      add(category, rng.int(30, 400) * 10 * DOLLAR);
    }
  }

  // One expense in a category the contract does not allow.
  const notAllowed: ExpenseCategory = rng.pick(["office_supplies", "other"]);
  const id = add(notAllowed, rng.int(5, 60) * 10 * DOLLAR);
  plantedViolations.push({ expenseId: id, kind: "category_not_allowed" });

  return { expenses, plantedViolations };
}

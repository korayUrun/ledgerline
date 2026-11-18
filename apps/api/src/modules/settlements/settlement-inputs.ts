import { createHash } from "node:crypto";
import type { Prisma } from "@ledgerline/db";
import { ContractTermsSchema, type SettlementInput } from "@ledgerline/schemas";
import { canonicalJson } from "../../common/canonical-json.js";

export type LiveInputs = {
  termsId: string;
  input: SettlementInput;
};

// Reads the show's CURRENT inputs from the database and shapes them exactly as the
// engine expects. Used twice: to build the snapshot at compute time, and later to
// check whether the stored snapshot still matches the live data.
//
// Returns null when the show has no terms yet (nothing can be computed).
// Accepts a transaction client so the reads can be part of a larger transaction.
export async function loadLiveInputs(
  db: Prisma.TransactionClient,
  showId: string,
): Promise<LiveInputs | null> {
  const termsRow = await db.contractTerms.findFirst({
    where: { showId },
    orderBy: { version: "desc" }, // the latest version wins
  });
  if (!termsRow) {
    return null;
  }

  // A fixed order, so the same rows always give the same snapshot and hash.
  // Ticket sales sort by tier name, which is unique per show. createdAt would not
  // work: an import inserts all tiers in one transaction, and Postgres's now() is
  // the transaction's start time, so every tier gets the same createdAt.
  const ticketSales = await db.ticketSale.findMany({
    where: { showId },
    orderBy: { tierName: "asc" },
  });
  // Expenses are added one request at a time, so createdAt orders them as entered;
  // id breaks the tie for rows inserted together (e.g. by the seed).
  const expenses = await db.expense.findMany({
    where: { showId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // Each field is copied by name instead of passing whole rows: the snapshot holds
  // what the engine reads and nothing else (no timestamps, no descriptions), so
  // editing a description does not change the hash.
  const input: SettlementInput = {
    // termsJson is untyped JSON from the database; parse it instead of trusting it.
    // A ZodError here becomes a 422 in ApiExceptionFilter.
    terms: ContractTermsSchema.parse(termsRow.termsJson),
    ticketSales: ticketSales.map((sale) => ({
      id: sale.id,
      tierName: sale.tierName,
      qtySold: sale.qtySold,
      comps: sale.comps,
      priceCents: sale.priceCents,
      taxCents: sale.taxCents,
      feeCents: sale.feeCents,
    })),
    expenses: expenses.map((expense) => ({
      id: expense.id,
      category: expense.category,
      amountCents: expense.amountCents,
      status: expense.status,
    })),
  };
  return { termsId: termsRow.id, input };
}

// SHA-256 of the canonical JSON. Same input → same hash, on any machine, at any
// time. One changed cent anywhere → a completely different hash.
export function hashSettlementInput(input: SettlementInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

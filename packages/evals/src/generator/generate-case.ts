import type { ContractTerms, DealType } from "@ledgerline/schemas";
import { computeSettlement } from "@ledgerline/settlement-engine";
import type { EvalCase } from "../dataset.js";
import { contractToText, renderContract, type Parties } from "./contract.js";
import { renderPdf } from "./pdf.js";
import { createRng, type Rng } from "./random.js";
import { generateExpenses, generateTicketSales } from "./scenario.js";
import { generateBonus, generateDeal, generateExpensePolicy } from "./terms.js";

// Ground truth by construction (docs/SYSTEM.md §11): first the terms are chosen,
// then the contract is written from them, then the expected payout is computed by
// the engine. Nobody labels anything by hand, so the labels cannot be wrong.

export const DATASET_SIZE = 25;

const DEAL_TYPES: readonly DealType[] = ["flat", "percentage", "versus", "guarantee_plus"];

export type GeneratedCase = { evalCase: EvalCase; pdf: Buffer; text: string };

export function caseId(index: number): string {
  return `c${String(index + 1).padStart(2, "0")}`;
}

// index 0..24 → one case. The seed comes from the index, so case c07 is the same
// contract on every machine and every run.
export async function generateCase(index: number): Promise<GeneratedCase> {
  const seed = 1000 + index;
  const rng = createRng(seed);
  // Deal types rotate, so the 25 cases cover all four types evenly (7/6/6/6).
  const dealType = DEAL_TYPES[index % DEAL_TYPES.length]!;
  // Two of the 25 contracts (c08, c20) carry a prompt-injection sentence.
  const withInjection = index % 12 === 7;

  const parties = generateParties(rng);
  const ticketSales = generateTicketSales(rng);
  const ticketsSold = ticketSales.reduce((sum, sale) => sum + sale.qtySold, 0);
  const nborCents = ticketSales.reduce(
    (sum, sale) => sum + sale.qtySold * sale.priceCents - sale.taxCents - sale.feeCents,
    0,
  );
  const draftTerms: ContractTerms = {
    deal: generateDeal(rng, dealType, nborCents),
    expensePolicy: generateExpensePolicy(rng, dealType),
    bonus: generateBonus(rng, ticketsSold),
  };
  const { expenses, plantedViolations } = generateExpenses(rng, draftTerms.expensePolicy);

  const contract = renderContract(rng, { terms: draftTerms, parties, ticketSales, withInjection });
  // Now that the text decided where each clause sits, the ground truth gets its refs.
  const terms: ContractTerms = {
    deal: { ...draftTerms.deal, clauseRef: contract.clauseRefs.deal },
    expensePolicy: { ...draftTerms.expensePolicy, clauseRef: contract.clauseRefs.expensePolicy },
    bonus:
      draftTerms.bonus && contract.clauseRefs.bonus
        ? { ...draftTerms.bonus, clauseRef: contract.clauseRefs.bonus }
        : null,
  };

  const { payoutCents } = computeSettlement({ terms, ticketSales, expenses });

  return {
    evalCase: {
      id: caseId(index),
      seed,
      dealType,
      tags: contract.tags,
      parties,
      terms,
      ticketSales,
      expenses,
      plantedViolations,
      expectedPayoutCents: payoutCents,
    },
    pdf: await renderPdf(contract.document),
    text: contractToText(contract.document),
  };
}

const ADJECTIVES = [
  "Velvet",
  "Copper",
  "Northern",
  "Paper",
  "Silver",
  "Midnight",
  "Hollow",
  "Golden",
];
const NOUNS = ["Owls", "Lanterns", "Rivers", "Harbors", "Engines", "Foxes", "Satellites", "Pines"];
const VENUES = ["Hall 9", "The Granary", "Riverside Ballroom", "The Foundry", "Union Stage"];
const PROMOTERS = ["Northgate Live LLC", "Bluebird Presents Inc.", "Lantern Hill Productions LLC"];

function generateParties(rng: Rng): Parties {
  const month = String(rng.int(1, 12)).padStart(2, "0");
  const day = String(rng.int(1, 28)).padStart(2, "0");
  return {
    artistName: `The ${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`,
    venueName: rng.pick(VENUES),
    promoterName: rng.pick(PROMOTERS),
    showDate: `2026-${month}-${day}`,
  };
}

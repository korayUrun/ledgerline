import {
  ExpenseCategorySchema,
  parseDollarsToCents,
  parsePercentToBps,
  type ContractExtraction,
  type ContractTerms,
  type Evidence,
  type ExpenseCategory,
  type TermsDraft,
} from "@ledgerline/schemas";

// The deal-terms form is used twice: typing terms in by hand (terms page) and
// reviewing what Claude extracted (contract review page). Both pre-fill it from
// a TermsDraft and read it back with termsFromForm, so the two screens can never
// disagree on how a field is parsed.

// Confirmed terms → draft (nothing missing), to pre-fill the form.
export function termsToDraft(terms: ContractTerms): TermsDraft {
  const { deal, expensePolicy, bonus } = terms;
  return {
    dealType: deal.type,
    guaranteeCents: "guaranteeCents" in deal ? deal.guaranteeCents : null,
    artistShareBps: "artistShareBps" in deal ? deal.artistShareBps : null,
    promoterProfitBps: deal.type === "guarantee_plus" ? deal.promoterProfitBps : null,
    dealClauseRef: deal.clauseRef,
    allowedCategories: expensePolicy.allowedCategories,
    categoryCaps: expensePolicy.categoryCaps,
    totalCapCents: expensePolicy.totalCapCents,
    expenseClauseRef: expensePolicy.clauseRef,
    bonus: bonus && { mode: bonus.mode, tiers: bonus.tiers, clauseRef: bonus.clauseRef },
  };
}

// Text → cents / bps. A blank optional field means "not in the contract" (null);
// a filled-in field that does not parse is a problem, never silently dropped.
// The API validates the result again with ContractTermsSchema.
export function termsFromForm(form: FormData): {
  terms: ContractTerms | null;
  problems: string[];
} {
  const problems: string[] = [];
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  function dollars(name: string, label: string): number {
    const cents = parseDollarsToCents(text(name));
    if (cents === null) problems.push(`${label}: enter a dollar amount like 5000.00`);
    return cents ?? 0;
  }
  function optionalDollars(name: string, label: string): number | null {
    return text(name) === "" ? null : dollars(name, label);
  }
  function percent(name: string, label: string): number {
    const bps = parsePercentToBps(text(name));
    if (bps === null) problems.push(`${label}: enter a percentage like 85 or 12.5`);
    return bps ?? 0;
  }

  const clauseRef = text("dealClause");
  let deal: ContractTerms["deal"];
  switch (text("dealType")) {
    case "flat":
      deal = { type: "flat", guaranteeCents: dollars("guarantee", "Guarantee"), clauseRef };
      break;
    case "percentage":
      deal = {
        type: "percentage",
        artistShareBps: percent("artistShare", "Artist share"),
        clauseRef,
      };
      break;
    case "versus":
      deal = {
        type: "versus",
        guaranteeCents: dollars("guarantee", "Guarantee"),
        artistShareBps: percent("artistShare", "Artist share"),
        clauseRef,
      };
      break;
    case "guarantee_plus":
      deal = {
        type: "guarantee_plus",
        guaranteeCents: dollars("guarantee", "Guarantee"),
        artistShareBps: percent("artistShare", "Artist share"),
        promoterProfitBps: percent("promoterProfit", "Promoter profit"),
        clauseRef,
      };
      break;
    default:
      return { terms: null, problems: ["Choose a deal type."] };
  }

  const allowedCategories: ExpenseCategory[] = ExpenseCategorySchema.options.filter(
    (category) => form.get(`allow_${category}`) === "on",
  );
  const categoryCaps = allowedCategories.flatMap((category) => {
    const capCents = optionalDollars(`cap_${category}`, `Cap for ${category}`);
    return capCents === null ? [] : [{ category, capCents }];
  });

  // The form renders at least 3 tier rows, more when the contract has more.
  const tierCount = Number(text("tierCount")) || 3;
  const tiers = Array.from({ length: tierCount }, (_, index) => index).flatMap((index) => {
    const minTickets = text(`tierTickets_${index}`);
    if (minTickets === "" && text(`tierBonus_${index}`) === "") return [];
    if (!/^\d+$/.test(minTickets)) {
      problems.push(`Bonus tier ${index + 1}: tickets must be a whole number`);
    }
    return [
      {
        minTicketsSold: Number(minTickets),
        bonusCents: dollars(`tierBonus_${index}`, `Bonus tier ${index + 1}`),
      },
    ];
  });

  const bonusMode = text("bonusMode");
  const terms: ContractTerms = {
    deal,
    expensePolicy: {
      allowedCategories,
      categoryCaps,
      totalCapCents: optionalDollars("totalCap", "Total expense cap"),
      clauseRef: text("expenseClause"),
    },
    bonus:
      bonusMode === "cumulative" || bonusMode === "highest_only"
        ? { mode: bonusMode, tiers, clauseRef: text("bonusClause") }
        : null,
  };
  return problems.length > 0 ? { terms: null, problems } : { terms, problems };
}

// Form field name → what the contract says about it. "missing" = Claude found
// no value; the reviewer must check the PDF and fill it in if it applies.
export type FieldEvidence = Evidence | "missing";
export type EvidenceMap = Record<string, FieldEvidence>;

export function evidenceFromExtraction(extraction: ContractExtraction): EvidenceMap {
  const { deal, expensePolicy, bonus } = extraction;
  const of = (field: { value: unknown; evidence: Evidence | null }): FieldEvidence =>
    field.value === null || field.evidence === null ? "missing" : field.evidence;
  const map: EvidenceMap = {
    dealType: of(deal.type),
    guarantee: of(deal.guarantee),
    artistShare: of(deal.artistShare),
    promoterProfit: of(deal.promoterProfit),
    dealClause: of(deal.clauseRef),
    allowedCategories: of(expensePolicy.allowedCategories),
    totalCap: of(expensePolicy.totalCap),
    expenseClause: of(expensePolicy.clauseRef),
    bonusMode: bonus ? of(bonus.mode) : "missing",
    bonusClause: bonus ? of(bonus.clauseRef) : "missing",
  };
  for (const cap of expensePolicy.categoryCaps) {
    map[`cap_${cap.category}`] = cap.evidence;
  }
  bonus?.tiers.forEach((tier, index) => {
    map[`tier_${index}`] = tier.evidence;
  });
  return map;
}

"use server";

// Server actions: functions that run on the Next.js server when a <form> is
// submitted. Each one turns form text into a typed request, calls the API, then
// redirects back to the page (with ?error=… when the API said no). Validation of
// the actual business rules happens in the API; here we only convert text.

import {
  ExpenseCategorySchema,
  ExpenseStatusSchema,
  parseDollarsToCents,
  parsePercentToBps,
  type ContractTerms,
  type CreateExpenseBody,
  type CreateShowBody,
  type ExpenseCategory,
  type UpdateExpenseBody,
} from "@ledgerline/schemas";
import { redirect } from "next/navigation";
import { api, ApiError } from "../lib/api";
import { withError } from "../lib/flash";

// Runs the API call and returns where to go next. redirect() works by throwing,
// so it must be called outside any try/catch; that is why this returns a path.
async function callApi(returnPath: string, call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return returnPath;
  } catch (error) {
    if (error instanceof ApiError) {
      return withError(returnPath, error.body);
    }
    throw error;
  }
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

// --- Venues, artists, shows ---------------------------------------------------------

export async function createVenue(form: FormData): Promise<void> {
  redirect(await callApi("/shows", () => api.post("/venues", { name: text(form, "name") })));
}

export async function createArtist(form: FormData): Promise<void> {
  redirect(await callApi("/shows", () => api.post("/artists", { name: text(form, "name") })));
}

export async function createShow(form: FormData): Promise<void> {
  const body: CreateShowBody = {
    name: text(form, "name"),
    showDate: text(form, "showDate"),
    venueId: text(form, "venueId"),
    artistId: text(form, "artistId"),
  };
  redirect(await callApi("/shows", () => api.post("/shows", body)));
}

// --- Ticket sales ---------------------------------------------------------------------

export async function importTicketSales(showId: string, form: FormData): Promise<void> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(withError(`/shows/${showId}/import`, "Choose a CSV file first."));
  }
  const upload = new FormData();
  upload.append("file", file);
  const path = await callApi(`/shows/${showId}/import`, () =>
    api.post(`/shows/${showId}/ticket-sales/import`, upload),
  );
  redirect(path === `/shows/${showId}/import` ? `/shows/${showId}` : path);
}

// --- Expenses -------------------------------------------------------------------------

export async function createExpense(showId: string, form: FormData): Promise<void> {
  const amountCents = parseDollarsToCents(text(form, "amount"));
  const category = ExpenseCategorySchema.safeParse(text(form, "category"));
  const status = ExpenseStatusSchema.safeParse(text(form, "status"));
  if (amountCents === null || !category.success || !status.success) {
    redirect(
      withError(`/shows/${showId}`, "Enter a category, a status and an amount like 1250.00."),
    );
  }
  const body: CreateExpenseBody = {
    category: category.data,
    description: text(form, "description"),
    amountCents,
    status: status.data,
  };
  redirect(await callApi(`/shows/${showId}`, () => api.post(`/shows/${showId}/expenses`, body)));
}

export async function updateExpense(
  showId: string,
  expenseId: string,
  form: FormData,
): Promise<void> {
  const amountCents = parseDollarsToCents(text(form, "amount"));
  const status = ExpenseStatusSchema.safeParse(text(form, "status"));
  if (amountCents === null || !status.success) {
    redirect(withError(`/shows/${showId}`, "Enter an amount like 1250.00."));
  }
  const body: UpdateExpenseBody = {
    amountCents,
    status: status.data,
    description: text(form, "description"),
  };
  redirect(await callApi(`/shows/${showId}`, () => api.patch(`/expenses/${expenseId}`, body)));
}

export async function deleteExpense(showId: string, expenseId: string): Promise<void> {
  redirect(await callApi(`/shows/${showId}`, () => api.delete(`/expenses/${expenseId}`)));
}

export async function uploadReceipt(
  showId: string,
  expenseId: string,
  form: FormData,
): Promise<void> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(withError(`/shows/${showId}`, "Choose a receipt file first."));
  }
  const upload = new FormData();
  upload.append("file", file);
  redirect(
    await callApi(`/shows/${showId}`, () => api.post(`/expenses/${expenseId}/receipt`, upload)),
  );
}

// --- Terms ------------------------------------------------------------------------------

export async function saveTerms(showId: string, form: FormData): Promise<void> {
  const returnPath = `/shows/${showId}/terms`;
  const problems: string[] = [];

  // Text → cents / bps. A blank optional field means "not in the contract" (null);
  // a filled-in field that does not parse is an error, never silently dropped.
  function dollars(name: string, label: string): number {
    const cents = parseDollarsToCents(text(form, name));
    if (cents === null) problems.push(`${label}: enter a dollar amount like 5000.00`);
    return cents ?? 0;
  }
  function optionalDollars(name: string, label: string): number | null {
    return text(form, name) === "" ? null : dollars(name, label);
  }
  function percent(name: string, label: string): number {
    const bps = parsePercentToBps(text(form, name));
    if (bps === null) problems.push(`${label}: enter a percentage like 85 or 12.5`);
    return bps ?? 0;
  }

  const dealType = text(form, "dealType");
  const dealClause = text(form, "dealClause");
  let deal: ContractTerms["deal"];
  switch (dealType) {
    case "flat":
      deal = {
        type: "flat",
        guaranteeCents: dollars("guarantee", "Guarantee"),
        clauseRef: dealClause,
      };
      break;
    case "percentage":
      deal = {
        type: "percentage",
        artistShareBps: percent("artistShare", "Artist share"),
        clauseRef: dealClause,
      };
      break;
    case "versus":
      deal = {
        type: "versus",
        guaranteeCents: dollars("guarantee", "Guarantee"),
        artistShareBps: percent("artistShare", "Artist share"),
        clauseRef: dealClause,
      };
      break;
    case "guarantee_plus":
      deal = {
        type: "guarantee_plus",
        guaranteeCents: dollars("guarantee", "Guarantee"),
        artistShareBps: percent("artistShare", "Artist share"),
        promoterProfitBps: percent("promoterProfit", "Promoter profit"),
        clauseRef: dealClause,
      };
      break;
    default:
      redirect(withError(returnPath, "Choose a deal type."));
  }

  const allowedCategories: ExpenseCategory[] = ExpenseCategorySchema.options.filter(
    (category) => form.get(`allow_${category}`) === "on",
  );
  const categoryCaps = allowedCategories.flatMap((category) => {
    const capCents = optionalDollars(`cap_${category}`, `Cap for ${category}`);
    return capCents === null ? [] : [{ category, capCents }];
  });

  const bonusMode = text(form, "bonusMode");
  const tiers = [0, 1, 2].flatMap((index) => {
    const minTickets = text(form, `tierTickets_${index}`);
    if (minTickets === "" && text(form, `tierBonus_${index}`) === "") return [];
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

  const terms: ContractTerms = {
    deal,
    expensePolicy: {
      allowedCategories,
      categoryCaps,
      totalCapCents: optionalDollars("totalCap", "Total expense cap"),
      clauseRef: text(form, "expenseClause"),
    },
    bonus:
      bonusMode === "cumulative" || bonusMode === "highest_only"
        ? { mode: bonusMode, tiers, clauseRef: text(form, "bonusClause") }
        : null,
  };

  if (problems.length > 0) {
    redirect(
      withError(returnPath, {
        statusCode: 400,
        message: "Some fields need fixing",
        issues: problems.map((message) => ({ path: "", message })),
      }),
    );
  }
  // The API validates the whole object with ContractTermsSchema and answers 400
  // with the exact field paths if anything breaks a rule.
  redirect(await callApi(returnPath, () => api.post(`/shows/${showId}/terms`, terms)));
}

// --- Settlement ---------------------------------------------------------------------------

export async function computeSettlement(showId: string): Promise<void> {
  const path = `/shows/${showId}/settlement`;
  redirect(await callApi(path, () => api.post(`/shows/${showId}/settlement/compute`)));
}

export async function submitForReview(showId: string): Promise<void> {
  const path = `/shows/${showId}/settlement`;
  redirect(await callApi(path, () => api.post(`/shows/${showId}/settlement/submit-for-review`)));
}

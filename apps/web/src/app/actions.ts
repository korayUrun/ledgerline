"use server";

// Server actions: functions that run on the Next.js server when a <form> is
// submitted. Each one turns form text into a typed request, calls the API, then
// redirects back to the page (with ?error=… when the API said no). Validation of
// the actual business rules happens in the API; here we only convert text.

import {
  ExpenseCategorySchema,
  ExpenseStatusSchema,
  parseDollarsToCents,
  type ApiErrorDto,
  type CreateExpenseBody,
  type CreateShowBody,
  type UpdateExpenseBody,
} from "@ledgerline/schemas";
import { redirect } from "next/navigation";
import { api, ApiError } from "../lib/api";
import { withError } from "../lib/flash";
import { termsFromForm } from "../lib/terms-form";

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

// --- Terms and contracts ------------------------------------------------------------

function formProblems(problems: string[]): ApiErrorDto {
  return {
    statusCode: 400,
    message: "Some fields need fixing",
    issues: problems.map((message) => ({ path: "", message })),
  };
}

export async function saveTerms(showId: string, form: FormData): Promise<void> {
  const returnPath = `/shows/${showId}/terms`;
  const { terms, problems } = termsFromForm(form);
  if (!terms) {
    redirect(withError(returnPath, formProblems(problems)));
  }
  // The API validates the whole object with ContractTermsSchema and answers 400
  // with the exact field paths if anything breaks a rule.
  redirect(await callApi(returnPath, () => api.post(`/shows/${showId}/terms`, terms)));
}

export async function uploadContract(showId: string, form: FormData): Promise<void> {
  const returnPath = `/shows/${showId}/contract`;
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(withError(returnPath, "Choose a PDF file first."));
  }
  const upload = new FormData();
  upload.append("file", file);
  redirect(await callApi(returnPath, () => api.post(`/shows/${showId}/contracts`, upload)));
}

// The reviewer's confirmation (F3): the form's terms become a new terms version.
// On success, go to the terms page, which now shows that version.
export async function confirmContract(
  showId: string,
  contractId: string,
  form: FormData,
): Promise<void> {
  const returnPath = `/shows/${showId}/contract/${contractId}`;
  const { terms, problems } = termsFromForm(form);
  if (!terms) {
    redirect(withError(returnPath, formProblems(problems)));
  }
  const path = await callApi(returnPath, () => api.post(`/contracts/${contractId}/confirm`, terms));
  redirect(path === returnPath ? `/shows/${showId}/terms` : path);
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

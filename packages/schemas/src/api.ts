import { z } from "zod";
import type { ContractExtraction, TermsDraft } from "./contract-extraction.js";
import {
  ContractTermsSchema,
  ExpenseCategorySchema,
  type ContractTerms,
} from "./contract-terms.js";
import { CentsSchema } from "./money.js";
import {
  ExpenseStatusSchema,
  type SettlementInput,
  type SettlementLine,
  type TicketSale,
} from "./settlement.js";

// The HTTP contract between apps/api and its clients (web now, MCP in Phase 6).
// Request bodies are Zod schemas, because the API must validate them at runtime.
// Responses are plain types: the API builds them itself, and clients only need
// the compile-time shape.

// --- Settlement status ---------------------------------------------------------------

// docs/SYSTEM.md §5. approved, paying, paid and payment_failed are Phase 5.
export const SettlementStatusSchema = z.enum([
  "draft",
  "computed",
  "in_review",
  "stale",
  "approved", // a person approved it; the payout starts in the same transaction
  "paying", // a Payout is pending or processing
  "paid", // final: the money arrived (or there was nothing to pay)
  "payment_failed", // the last Payout failed; a person may retry
]);
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;

// One Payout row per attempt to send the money (docs/SYSTEM.md §8).
export const PayoutStatusSchema = z.enum(["pending", "processing", "succeeded", "failed"]);
export type PayoutStatus = z.infer<typeof PayoutStatusSchema>;

// --- Contract status (docs/SYSTEM.md §5) ------------------------------------------------

export const ContractStatusSchema = z.enum([
  "uploaded",
  "extracting",
  "needs_review",
  "confirmed",
  "failed",
]);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

// --- Request bodies --------------------------------------------------------------------

const NameSchema = z.string().trim().min(1).max(200);

// --- Login (Phase 5) ---------------------------------------------------------------------

export const LoginBodySchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string().min(1).max(200),
});
export type LoginBody = z.infer<typeof LoginBodySchema>;

export type UserDto = { id: string; email: string; name: string };

// The token goes into an httpOnly cookie on the web server and comes back on every
// API request as "Authorization: Bearer <token>".
export type LoginResponseDto = { token: string; expiresAt: string; user: UserDto };

// --- API keys (Phase 6) -------------------------------------------------------------------
// Managed by a logged-in person through these routes; used by other tools on /v1.

export const CreateApiKeyBodySchema = z.object({ name: z.string().trim().min(1).max(100) });
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBodySchema>;

// Never contains the key or its hash: after creation, nobody can read a key again.
export type ApiKeyDto = {
  id: string;
  name: string;
  prefix: string; // "3f9a1c2e": shown as "ll_3f9a1c2e_…" so a person can tell keys apart
  createdByName: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null; // set = the key no longer works
};

// The only response that ever contains the full key.
export type CreatedApiKeyDto = { apiKey: ApiKeyDto; key: string };

export const CreateVenueBodySchema = z.object({ name: NameSchema });
export type CreateVenueBody = z.infer<typeof CreateVenueBodySchema>;

export const CreateArtistBodySchema = z.object({ name: NameSchema });
export type CreateArtistBody = z.infer<typeof CreateArtistBodySchema>;

export const CreateShowBodySchema = z.object({
  name: NameSchema,
  showDate: z.iso.date(), // "2026-11-06": a calendar day, no time zone
  venueId: z.uuid(),
  artistId: z.uuid(),
});
export type CreateShowBody = z.infer<typeof CreateShowBodySchema>;

export const CreateExpenseBodySchema = z.object({
  category: ExpenseCategorySchema,
  description: NameSchema,
  amountCents: CentsSchema,
  status: ExpenseStatusSchema.default("pending"),
});
export type CreateExpenseBody = z.input<typeof CreateExpenseBodySchema>;

export const UpdateExpenseBodySchema = z
  .object({
    category: ExpenseCategorySchema,
    description: NameSchema,
    amountCents: CentsSchema,
    status: ExpenseStatusSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });
export type UpdateExpenseBody = z.infer<typeof UpdateExpenseBodySchema>;

// Saving terms creates a new version; the body is the full terms object.
export const SaveTermsBodySchema = ContractTermsSchema;

// Confirming an extracted contract: the reviewed (and possibly edited) terms. The
// same rules as hand-entered terms; the reviewer has filled every gap.
export const ConfirmContractBodySchema = ContractTermsSchema;

// --- Responses -------------------------------------------------------------------------
// Dates are ISO strings, because that is what JSON.stringify makes of a Date.

export type VenueDto = { id: string; name: string };
export type ArtistDto = {
  id: string;
  name: string;
  stripeAccountId: string | null; // the connected account payouts go to (Phase 5)
};

// POST /artists/:id/stripe-account: the Stripe-hosted page where the artist's test
// account is set up (bank details, identity) before it can receive transfers.
export type StripeOnboardingDto = { stripeAccountId: string; onboardingUrl: string };

export type ShowDto = {
  id: string;
  name: string;
  showDate: string; // "2026-11-06"
  venue: VenueDto;
  artist: ArtistDto;
  settlementStatus: SettlementStatus | null; // null = no settlement yet
};

export type TicketSaleDto = TicketSale;

export type ExpenseDto = {
  id: string;
  category: z.infer<typeof ExpenseCategorySchema>;
  description: string;
  amountCents: number;
  status: z.infer<typeof ExpenseStatusSchema>;
  hasReceipt: boolean;
  updatedAt: string;
};

export type TermsVersionSummaryDto = {
  id: string;
  version: number;
  confirmedByName: string;
  confirmedAt: string;
  contractId: string | null; // set when confirmed from an extracted contract
};

export type ContractUsageDto = {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costNanoUsd: number | null; // 1 USD = 1e9; null when the model has no known price
};

export type ContractDto = {
  id: string;
  showId: string;
  fileName: string;
  status: ContractStatus;
  failureReason: string | null;
  usage: ContractUsageDto | null;
  createdAt: string;
  updatedAt: string;
};

export type ContractDetailDto = ContractDto & {
  promptVersion: string | null;
  // What Claude read, with evidence quotes. null until extraction succeeds.
  extraction: ContractExtraction | null;
  // The same, converted to cents and basis points for the review form.
  draft: TermsDraft | null;
};

export type TermsDto = {
  latest: (TermsVersionSummaryDto & { terms: ContractTerms }) | null;
  versions: TermsVersionSummaryDto[]; // newest first
};

export type SettlementDto = {
  id: string;
  status: SettlementStatus;
  version: number;
  // The fields below are null while the settlement is a draft.
  termsVersion: number | null;
  payoutCents: number | null;
  inputsHash: string | null;
  engineVersion: string | null;
  computedAt: string | null;
  inputSnapshot: SettlementInput | null;
  lines: SettlementLine[]; // worksheet order
};

export type PayoutDto = {
  id: string;
  attempt: number; // 1 for the first try; a retry after a failure is a new payout
  amountCents: number;
  status: PayoutStatus;
  idempotencyKey: string;
  stripeTransferId: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SettlementViewDto = {
  settlement: SettlementDto | null;
  payouts: PayoutDto[]; // newest attempt first
  // Expenses nobody has reviewed yet. They count in the math, but block review.
  pendingExpenseCount: number;
};

export type AuditEntryDto = {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  at: string;
};

// Every error the API returns has this shape. `issues` is set for validation
// errors (400 for a bad request, 422 for stored data the engine rejects).
export type ApiErrorDto = {
  statusCode: number;
  message: string;
  issues?: { path: string; message: string }[];
};

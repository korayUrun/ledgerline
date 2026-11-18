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

// Phase 2 states. approved, paying, paid and payment_failed arrive in Phase 5.
export const SettlementStatusSchema = z.enum(["draft", "computed", "in_review", "stale"]);
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;

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
export type ArtistDto = { id: string; name: string };

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

export type SettlementViewDto = {
  settlement: SettlementDto | null;
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

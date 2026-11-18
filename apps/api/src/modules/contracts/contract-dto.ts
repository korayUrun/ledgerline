import type { Contract } from "@ledgerline/db";
import {
  ContractExtractionSchema,
  extractionToDraft,
  type ContractDetailDto,
  type ContractDto,
} from "@ledgerline/schemas";
import { z } from "zod";

// What the worker stores in Contract.llmUsage (ExtractionUsage). Parsed, not cast:
// a JSON column is untyped data.
const StoredUsageSchema = z.object({
  model: z.string(),
  calls: z.int(),
  inputTokens: z.int(),
  outputTokens: z.int(),
  costNanoUsd: z.int().nullable(),
});

export function toContractDto(row: Contract): ContractDto {
  return {
    id: row.id,
    showId: row.showId,
    fileName: row.fileName,
    status: row.status,
    failureReason: row.failureReason,
    usage: row.llmUsage === null ? null : StoredUsageSchema.parse(row.llmUsage),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toContractDetailDto(row: Contract): ContractDetailDto {
  // Validated before it was stored, and again now: a schema change since then
  // should fail loudly here (422), not show the reviewer half-broken fields.
  const extraction =
    row.extractionJson === null ? null : ContractExtractionSchema.parse(row.extractionJson);
  return {
    ...toContractDto(row),
    promptVersion: row.promptVersion,
    extraction,
    draft: extraction === null ? null : extractionToDraft(extraction),
  };
}

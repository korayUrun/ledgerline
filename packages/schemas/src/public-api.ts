import { z } from "zod";
import { SettlementStatusSchema } from "./api.js";

// The public /v1 API (F9): what other tools (the MCP server, a finance tool) get back.
//
// Unlike api.ts, the responses here are Zod schemas, not plain types, because:
//   - the API parses every /v1 response with its schema before sending it, so the
//     published contract is checked, not hoped for;
//   - the OpenAPI document is generated from these schemas (z.toJSONSchema);
//   - clients such as the MCP server can validate what they receive.
//
// Changing a field here changes a public contract. Adding a field is fine; renaming
// or removing one breaks clients and belongs in a /v2.

// Money is given twice: `cents` for programs (exact, integer) and `formatted` for
// people and language models, which should quote amounts, never compute them.
export const MoneySchema = z.object({
  cents: z.int().min(0),
  formatted: z.string(), // "$12,345.67"
});
export type Money = z.infer<typeof MoneySchema>;

// Shows -----------------------------------------------------------------------------------

export const V1ShowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  showDate: z.iso.date(), // "2026-11-06"
  venueName: z.string(),
  artistName: z.string(),
  // null = nothing computed yet. `id` is what the /v1/settlements routes take.
  settlement: z
    .object({
      id: z.uuid(),
      status: SettlementStatusSchema,
      payout: MoneySchema.nullable(), // null while the settlement is a draft
    })
    .nullable(),
});
export type V1Show = z.infer<typeof V1ShowSchema>;

// Lists come wrapped in { data }, so fields such as a pagination cursor can be added
// later without breaking clients that read `data`.
export const V1ShowListSchema = z.object({ data: z.array(V1ShowSchema) });
export type V1ShowList = z.infer<typeof V1ShowListSchema>;

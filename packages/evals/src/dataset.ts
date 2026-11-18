import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CentsSchema,
  ContractTermsSchema,
  ExpenseCategorySchema,
  TicketSaleSchema,
} from "@ledgerline/schemas";
import { z } from "zod";

// One eval case on disk: dataset/<id>/case.json + contract.pdf + contract.txt.
// case.json is the ground truth. It is parsed with Zod when loaded, because a
// hand-edited or stale file should fail loudly, not score against garbage.

export const DATASET_DIR = fileURLToPath(new URL("../dataset", import.meta.url));

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  seed: z.int(),
  dealType: z.enum(["flat", "percentage", "versus", "guarantee_plus"]),
  // Hard features of this contract (e.g. "deposit_distractor", "prompt_injection").
  tags: z.array(z.string()),
  parties: z.object({
    artistName: z.string(),
    venueName: z.string(),
    promoterName: z.string(),
    showDate: z.iso.date(),
  }),
  terms: ContractTermsSchema, // the ground truth the extractor is scored against
  ticketSales: z.array(TicketSaleSchema),
  expenses: z.array(
    z.object({
      id: z.string(),
      category: ExpenseCategorySchema,
      description: z.string(),
      amountCents: CentsSchema,
      status: z.literal("pending"),
    }),
  ),
  // Expenses that break the contract on purpose; scored against the agent in Phase 4.
  plantedViolations: z.array(
    z.object({
      expenseId: z.string(),
      kind: z.enum(["category_not_allowed", "over_category_cap"]),
    }),
  ),
  // settlement-engine(terms, ticketSales, expenses).payoutCents
  expectedPayoutCents: z.int().min(0),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export type LoadedCase = { evalCase: EvalCase; pdf: Buffer };

export async function listCaseIds(datasetDir = DATASET_DIR): Promise<string[]> {
  const entries = await readdir(datasetDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function loadCase(id: string, datasetDir = DATASET_DIR): Promise<LoadedCase> {
  const caseDir = path.join(datasetDir, id);
  const json: unknown = JSON.parse(await readFile(path.join(caseDir, "case.json"), "utf8"));
  return {
    evalCase: EvalCaseSchema.parse(json),
    pdf: await readFile(path.join(caseDir, "contract.pdf")),
  };
}

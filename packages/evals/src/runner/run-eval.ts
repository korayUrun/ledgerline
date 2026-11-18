import {
  ExtractionFailedError,
  extractContractTerms,
  type ExtractionUsage,
  type LlmClient,
} from "@ledgerline/api";
import { extractionToDraft } from "@ledgerline/schemas";
import type { LoadedCase } from "../dataset.js";
import { scoreFields, scorePayout, type FieldScore, type PayoutScore } from "./score.js";

// Runs the production extraction on each case and scores it. No files, no
// console: the script (src/scripts/run-evals.ts) does the I/O, so this part can be
// tested with the oracle.

export type CaseResult = {
  id: string;
  dealType: string;
  tags: string[];
  attempts: number; // 1 = no retry needed
  failure: string | null; // why the extraction failed, if it did
  fields: FieldScore[];
  payout: PayoutScore;
  expectedPayoutCents: number;
  usage: ExtractionUsage | null;
  durationMs: number;
};

export type EvalOptions = {
  model: string;
  llmFor: (loaded: LoadedCase) => LlmClient;
  concurrency: number;
  onCaseDone?: (result: CaseResult) => void;
};

export async function runEval(cases: LoadedCase[], options: EvalOptions): Promise<CaseResult[]> {
  const results: CaseResult[] = new Array<CaseResult>(cases.length);
  let next = 0;
  // A tiny worker pool: `concurrency` loops each take the next case until none
  // are left. Enough parallelism to finish 25 contracts in minutes, few enough
  // requests at once to stay clear of rate limits.
  async function work(): Promise<void> {
    while (next < cases.length) {
      const index = next++;
      results[index] = await runCase(cases[index]!, options);
      options.onCaseDone?.(results[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, cases.length) }, work));
  return results;
}

async function runCase(loaded: LoadedCase, options: EvalOptions): Promise<CaseResult> {
  const { evalCase } = loaded;
  const startedAt = Date.now();
  let draft = null;
  let attempts = 0;
  let failure: string | null = null;
  let usage: ExtractionUsage | null = null;
  try {
    const result = await extractContractTerms(options.llmFor(loaded), {
      pdf: loaded.pdf,
      model: options.model,
    });
    draft = extractionToDraft(result.extraction);
    attempts = result.attempts;
    usage = result.usage;
  } catch (error) {
    // A failed extraction is a result to report, not a reason to stop the run.
    if (error instanceof ExtractionFailedError) {
      attempts = error.attempts;
      usage = error.usage;
      failure = [error.reason, ...error.issues].join("; ");
    } else {
      failure = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return {
    id: evalCase.id,
    dealType: evalCase.dealType,
    tags: evalCase.tags,
    attempts,
    failure,
    fields: scoreFields(evalCase.terms, draft),
    payout: scorePayout(
      draft,
      evalCase.ticketSales,
      evalCase.expenses,
      evalCase.expectedPayoutCents,
    ),
    expectedPayoutCents: evalCase.expectedPayoutCents,
    usage,
    durationMs: Date.now() - startedAt,
  };
}

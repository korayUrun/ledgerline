import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ContractExtractionSchema, type ContractExtraction } from "@ledgerline/schemas";
import { formatZodIssues } from "../../../common/zod-issues.js";
import type { LlmCallUsage, LlmClient } from "../../llm/llm-client.js";
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_PROMPT,
} from "./extraction-prompt.js";

// PDF → ContractExtraction (F2, docs/SYSTEM.md §7.1):
//
//   PDF ─▶ Claude (document + JSON schema) ─▶ JSON.parse ─▶ Zod ─ok─▶ done
//                     ▲                                       │
//                     └──── retry with the errors (max 2) ◀───fail
//
// A plain function with the LlmClient passed in, not a Nest service: the worker
// calls it for real uploads and the eval runner calls the very same code on the
// dataset, so the eval measures exactly what production runs.

export const MAX_EXTRACTION_RETRIES = 2;

// The JSON Schema Claude must follow, built once from the Zod schema. The SDK
// helper also moves constraints the API does not support (minimum, maximum…) into
// the descriptions; Zod checks them again on our side.
const OUTPUT_FORMAT = zodOutputFormat(ContractExtractionSchema);

export type ExtractionUsage = {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costNanoUsd: number | null;
};

export type ExtractionResult = {
  extraction: ContractExtraction;
  attempts: number;
  promptVersion: string;
  usage: ExtractionUsage;
};

export type ExtractionFailureReason =
  | "invalid_output" // still failed validation after every retry
  | "refused" // stop_reason "refusal": the model declined
  | "truncated"; // stop_reason "max_tokens": the JSON was cut off

export class ExtractionFailedError extends Error {
  constructor(
    readonly reason: ExtractionFailureReason,
    readonly attempts: number,
    readonly issues: string[],
    readonly usage: ExtractionUsage,
  ) {
    super(`Contract extraction failed (${reason}) after ${attempts} attempt(s)`);
    this.name = "ExtractionFailedError";
  }
}

export async function extractContractTerms(
  llm: LlmClient,
  input: { pdf: Buffer; model: string },
): Promise<ExtractionResult> {
  // The conversation grows on each retry: the contract, our earlier (invalid)
  // reply, and what was wrong with it. Sending the whole history lets the model
  // fix exactly those fields instead of starting from scratch.
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: input.pdf.toString("base64"),
          },
        },
        { type: "text", text: EXTRACTION_USER_PROMPT },
      ],
    },
  ];
  const usage: ExtractionUsage = {
    model: input.model,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costNanoUsd: 0,
  };

  let issues: string[] = [];
  for (let attempt = 1; attempt <= 1 + MAX_EXTRACTION_RETRIES; attempt++) {
    const response = await llm.createMessage(
      {
        model: input.model,
        // Generous: the JSON is ~1–2k tokens, and thinking tokens count here too.
        max_tokens: 16_000,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages,
        // Thinking is adaptive (always on for this model); effort sets how hard it
        // thinks. medium is the model's default; we set it so it is visible.
        output_config: { effort: "medium", format: OUTPUT_FORMAT },
      },
      "contract-extraction",
    );
    addUsage(usage, response.usage);
    const { message } = response;

    // stop_reason before content: a refused or cut-off reply is not a JSON
    // problem, and retrying the same request would not fix it.
    if (message.stop_reason === "refusal") {
      throw new ExtractionFailedError("refused", attempt, [], usage);
    }
    if (message.stop_reason === "max_tokens") {
      throw new ExtractionFailedError("truncated", attempt, [], usage);
    }

    const parsed = parseReply(message);
    if (parsed.success) {
      return {
        extraction: parsed.extraction,
        attempts: attempt,
        promptVersion: EXTRACTION_PROMPT_VERSION,
        usage,
      };
    }

    issues = parsed.issues;
    messages.push(
      // The whole reply, not just its text: thinking blocks must be sent back
      // unchanged when the conversation continues.
      { role: "assistant", content: message.content },
      { role: "user", content: correctionPrompt(issues) },
    );
  }
  throw new ExtractionFailedError("invalid_output", 1 + MAX_EXTRACTION_RETRIES, issues, usage);
}

type ParsedReply =
  { success: true; extraction: ContractExtraction } | { success: false; issues: string[] };

function parseReply(message: Anthropic.Message): ParsedReply {
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { success: false, issues: ["the reply is not valid JSON"] };
  }
  // Untrusted output: parsed with Zod even though the API followed our schema,
  // because the refinements (evidence present, figures readable, terms that fit
  // the deal type…) cannot be expressed in JSON Schema.
  const result = ContractExtractionSchema.safeParse(json);
  if (!result.success) {
    return {
      success: false,
      issues: formatZodIssues(result.error).map((issue) => `${issue.path}: ${issue.message}`),
    };
  }
  return { success: true, extraction: result.data };
}

function correctionPrompt(issues: string[]): string {
  return [
    "Your JSON did not pass validation:",
    ...issues.map((issue) => `- ${issue}`),
    "Return the complete corrected JSON. Fix only these problems. If a value cannot be supported by an exact quote from the contract, set it to null instead of guessing.",
  ].join("\n");
}

function addUsage(total: ExtractionUsage, call: LlmCallUsage): void {
  total.calls += 1;
  total.inputTokens += call.inputTokens;
  total.outputTokens += call.outputTokens;
  // One unknown price makes the total unknown.
  total.costNanoUsd =
    total.costNanoUsd === null || call.costNanoUsd === null
      ? null
      : total.costNanoUsd + call.costNanoUsd;
}

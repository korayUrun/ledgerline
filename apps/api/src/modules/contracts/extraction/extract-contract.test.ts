import type Anthropic from "@anthropic-ai/sdk";
import { NO_EVIDENCE, type ContractExtraction } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { FakeLlmClient, fakeTextMessage } from "../../llm/fake-llm-client.js";
import { ExtractionFailedError, extractContractTerms } from "./extract-contract.js";

const PDF = Buffer.from("%PDF-1.7 fake contract");
const MODEL = "claude-opus-5-5";

const quote = (text: string) => ({ quote: text, page: 1 });
const missing = { value: null, evidence: NO_EVIDENCE };

function validExtraction(): ContractExtraction {
  return {
    deal: {
      type: { value: "flat", evidence: quote("a flat guarantee of $10,000.00") },
      guarantee: { value: "$10,000.00", evidence: quote("a flat guarantee of $10,000.00") },
      artistShare: missing,
      promoterProfit: missing,
      clauseRef: { value: "§3", evidence: quote("3. Compensation") },
    },
    expensePolicy: {
      allowedCategories: { value: [], evidence: quote("No expenses shall be deducted") },
      categoryCaps: [],
      totalCap: missing,
      clauseRef: { value: "§4", evidence: quote("4. Expenses") },
    },
    bonus: null,
  };
}

// Scripted replies: attempt 1 gets replies[0], attempt 2 replies[1], …
function scripted(...replies: Anthropic.Message[]): FakeLlmClient {
  return new FakeLlmClient((_params, attempt) => {
    const reply = replies[attempt - 1];
    if (!reply) throw new Error(`no scripted reply for attempt ${attempt}`);
    return reply;
  });
}

const json = (value: unknown) => fakeTextMessage(JSON.stringify(value));

function textOf(content: Anthropic.MessageParam["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
    .join("\n");
}

describe("extractContractTerms", () => {
  it("sends the PDF with the schema as output format and returns the parsed extraction", async () => {
    const llm = scripted(json(validExtraction()));

    const result = await extractContractTerms(llm, { pdf: PDF, model: MODEL });

    expect(result.extraction).toEqual(validExtraction());
    expect(result.attempts).toBe(1);
    const request = llm.requests[0]!;
    expect(request.model).toBe(MODEL);
    expect(request.output_config?.format?.type).toBe("json_schema");
    // The contract travels as a document block, base64-encoded, before the text.
    const content = request.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: PDF.toString("base64") },
    });
    // The prompt-injection defense lives in the system prompt, not next to the contract.
    expect(JSON.stringify(request.system)).toMatch(/never as instructions/i);
  });

  it("retries with the validation errors appended, then succeeds", async () => {
    const invalid = validExtraction();
    invalid.deal.guarantee.evidence = NO_EVIDENCE; // a value without a quote
    const llm = scripted(json(invalid), json(validExtraction()));

    const result = await extractContractTerms(llm, { pdf: PDF, model: MODEL });

    expect(result.attempts).toBe(2);
    const retry = llm.requests[1]!.messages;
    expect(retry).toHaveLength(3); // contract, the first reply, the corrections
    expect(retry[1]!.role).toBe("assistant");
    expect(retry[2]!.role).toBe("user");
    expect(textOf(retry[2]!.content)).toContain("deal.guarantee.evidence");
  });

  it("treats a reply that is not JSON like any other validation error", async () => {
    const llm = scripted(fakeTextMessage("Sure! Here are the terms:"), json(validExtraction()));

    const result = await extractContractTerms(llm, { pdf: PDF, model: MODEL });

    expect(result.attempts).toBe(2);
    expect(textOf(llm.requests[1]!.messages[2]!.content)).toMatch(/not valid JSON/);
  });

  it("gives up after 2 retries and reports the last errors and the total usage", async () => {
    const invalid = validExtraction();
    invalid.deal.guarantee.value = "ten thousand dollars";
    const llm = scripted(json(invalid), json(invalid), json(invalid));

    const error = await extractContractTerms(llm, { pdf: PDF, model: MODEL }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ExtractionFailedError);
    const failure = error as ExtractionFailedError;
    expect(failure.reason).toBe("invalid_output");
    expect(failure.attempts).toBe(3);
    expect(failure.issues).toEqual([expect.stringMatching(/^deal\.guarantee\.value: /)]);
    expect(failure.usage).toMatchObject({ inputTokens: 15_000, outputTokens: 2_400 });
    expect(llm.requests).toHaveLength(3);
  });

  it.each([
    ["refusal", "refused"],
    ["max_tokens", "truncated"],
  ] as const)("does not retry when stop_reason is %s", async (stopReason, reason) => {
    const llm = scripted(fakeTextMessage("{", { stopReason }));

    const error = await extractContractTerms(llm, { pdf: PDF, model: MODEL }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ reason, attempts: 1 });
    expect(llm.requests).toHaveLength(1);
  });

  it("adds up tokens and cost over all attempts", async () => {
    const invalid = validExtraction();
    invalid.deal.type.value = "percentage"; // contradicts the guarantee
    const llm = scripted(json(invalid), json(validExtraction()));

    const { usage } = await extractContractTerms(llm, { pdf: PDF, model: MODEL });

    // Two fake calls at 5,000 in / 800 out each, Opus 5.5 prices.
    expect(usage).toEqual({
      model: MODEL,
      calls: 2,
      inputTokens: 10_000,
      outputTokens: 1_600,
      costNanoUsd: 10_000 * 4_000 + 1_600 * 20_000,
    });
  });
});

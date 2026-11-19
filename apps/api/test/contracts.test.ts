import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  NO_EVIDENCE,
  type ContractDetailDto,
  type ContractDto,
  type ContractExtraction,
  type ContractTerms,
  type SettlementViewDto,
  type ShowDto,
  type TermsDto,
} from "@ledgerline/schemas";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExtractionProcessor } from "../src/modules/contracts/extraction/extraction-processor.js";
import { EXTRACTION_PROMPT_VERSION } from "../src/modules/contracts/extraction/extraction-prompt.js";
import { ExtractionQueue } from "../src/modules/contracts/extraction/extraction-queue.js";
import { FakeLlmClient, fakeTextMessage } from "../src/modules/llm/fake-llm-client.js";
import type { LlmClient } from "../src/modules/llm/llm-client.js";
import { WorkerModule } from "../src/worker.module.js";
import { resetDatabase, startTestApp, TICKET_SALES_CSV, type TestApp } from "./test-app.js";

// F2 + F3 + F8 against a real Postgres and a real Redis: upload → queue → worker
// → needs_review → confirm → compute. Claude is replaced by a scripted fake; the
// extraction logic itself is covered by the unit tests next to it.

let t: TestApp;
let showId: string;
let worker: INestApplicationContext | null = null;

const PDF = Buffer.from("%PDF-1.7\n% synthetic test contract\n");
const quote = (text: string) => ({ quote: text, page: 1 });
const missing = { value: null, evidence: NO_EVIDENCE };

// Claude's (fake) reading of a flat $10,000 contract.
const FLAT_EXTRACTION: ContractExtraction = {
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

// What a reviewer confirms after checking the quotes.
const FLAT_TERMS: ContractTerms = {
  deal: { type: "flat", guaranteeCents: 1_000_000, clauseRef: "§3" },
  expensePolicy: { allowedCategories: [], categoryCaps: [], totalCapCents: null, clauseRef: "§4" },
  bonus: null,
};

function answering(extraction: unknown): FakeLlmClient {
  return new FakeLlmClient(() => fakeTextMessage(JSON.stringify(extraction)));
}

async function startWorker(
  llmClient: LlmClient,
  options: { consumeQueue: boolean },
): Promise<INestApplicationContext> {
  worker = await NestFactory.createApplicationContext(
    WorkerModule.register(
      {
        ...t.config,
        llm: {
          client: "fake",
          apiKey: null,
          extractionModel: "claude-opus-5-5",
          timeoutMs: 1_000,
          maxRetries: 0,
        },
      },
      { llmClient, startQueueConsumer: options.consumeQueue },
    ),
    { logger: ["error"] },
  );
  return worker;
}

async function processor(llmClient: LlmClient): Promise<ExtractionProcessor> {
  return (await startWorker(llmClient, { consumeQueue: false })).get(ExtractionProcessor);
}

async function uploadContract(): Promise<ContractDto> {
  const { status, body } = await t.upload<ContractDto>(
    `/shows/${showId}/contracts`,
    "contract.pdf",
    PDF,
    "application/pdf",
  );
  expect(status).toBe(201);
  return body;
}

const getContract = async (id: string) =>
  (await t.request<ContractDetailDto>("GET", `/contracts/${id}`)).body;

const auditActions = async (contractId: string) =>
  (
    await t.prisma.auditLog.findMany({
      where: { entity: "contract", entityId: contractId },
      orderBy: { at: "asc" },
    })
  ).map((row) => row.action);

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});
afterEach(async () => {
  await worker?.close();
  worker = null;
});

beforeEach(async () => {
  await resetDatabase(t.prisma);
  const venue = await t.request<{ id: string }>("POST", "/venues", { name: "Test Hall" });
  const artist = await t.request<{ id: string }>("POST", "/artists", { name: "Test Band" });
  const show = await t.request<ShowDto>("POST", "/shows", {
    name: "Test Night",
    showDate: "2026-11-06",
    venueId: venue.body.id,
    artistId: artist.body.id,
  });
  showId = show.body.id;
});

describe("upload", () => {
  it("stores the PDF, records the upload and queues one extraction job", async () => {
    const contract = await uploadContract();

    expect(contract).toMatchObject({ status: "uploaded", fileName: "contract.pdf", usage: null });
    const pdf = await fetch(`${t.baseUrl}/contracts/${contract.id}/pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).equals(PDF)).toBe(true);
    expect(await auditActions(contract.id)).toEqual(["contract.uploaded"]);
    expect(await t.nest.get(ExtractionQueue).jobState(contract.id)).toBe("waiting");
  });

  it("refuses a file that is not a PDF, whatever its declared type", async () => {
    const { status, body } = await t.upload(
      `/shows/${showId}/contracts`,
      "contract.pdf",
      "this is plain text",
      "application/pdf",
    );
    expect(status).toBe(400);
    expect(body).toMatchObject({ message: "The contract must be a PDF file." });
    expect(await t.prisma.contract.count()).toBe(0);
  });
});

describe("extraction job", () => {
  it("moves the contract to needs_review with the extraction, the draft and the token usage", async () => {
    const contract = await uploadContract();

    const outcome = await (
      await processor(answering(FLAT_EXTRACTION))
    ).process(contract.id, { isLastAttempt: false });

    expect(outcome).toBe("extracted");
    const detail = await getContract(contract.id);
    expect(detail).toMatchObject({
      status: "needs_review",
      promptVersion: EXTRACTION_PROMPT_VERSION,
      extraction: FLAT_EXTRACTION,
      draft: { dealType: "flat", guaranteeCents: 1_000_000, dealClauseRef: "§3" },
      usage: { model: "claude-opus-5-5", calls: 1, inputTokens: 5_000, outputTokens: 800 },
    });
    expect(await auditActions(contract.id)).toEqual([
      "contract.uploaded",
      "contract.extraction_started",
      "contract.extracted",
    ]);
  });

  it("does nothing when the same job runs again (duplicate job, retry after a crash)", async () => {
    const contract = await uploadContract();
    const llm = answering(FLAT_EXTRACTION);
    const run = await processor(llm);

    await run.process(contract.id, { isLastAttempt: false });
    const second = await run.process(contract.id, { isLastAttempt: false });

    expect(second).toBe("skipped");
    expect(llm.requests).toHaveLength(1); // Claude was called (and billed) once
    expect(await auditActions(contract.id)).toHaveLength(3);
  });

  it("marks the contract failed when Claude's answer stays invalid after the retries", async () => {
    const contract = await uploadContract();
    const invalid = structuredClone(FLAT_EXTRACTION);
    invalid.deal.guarantee.evidence = NO_EVIDENCE;
    const llm = answering(invalid);

    const outcome = await (await processor(llm)).process(contract.id, { isLastAttempt: false });

    expect(outcome).toBe("failed");
    expect(llm.requests).toHaveLength(3); // 1 try + 2 retries
    const detail = await getContract(contract.id);
    expect(detail.status).toBe("failed");
    expect(detail.failureReason).toMatch(/^invalid_output; deal\.guarantee\.evidence\.quote: /);
    expect(detail.usage).toMatchObject({ calls: 3 });
  });

  it("lets BullMQ retry an unexpected error, and marks the contract failed on the last attempt", async () => {
    const contract = await uploadContract();
    const broken = new FakeLlmClient(() => {
      throw new Error("connection reset");
    });
    const run = await processor(broken);

    await expect(run.process(contract.id, { isLastAttempt: false })).rejects.toThrow(
      "connection reset",
    );
    expect((await getContract(contract.id)).status).toBe("extracting"); // will be retried

    await expect(run.process(contract.id, { isLastAttempt: true })).rejects.toThrow();
    const detail = await getContract(contract.id);
    expect(detail.status).toBe("failed");
    expect(detail.failureReason).toBe("error: connection reset");
  });

  it("runs end to end through Redis: the worker picks up the uploaded contract", async () => {
    await startWorker(answering(FLAT_EXTRACTION), { consumeQueue: true });
    const contract = await uploadContract();

    let status = contract.status;
    for (let poll = 0; poll < 50 && status !== "needs_review"; poll++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = (await getContract(contract.id)).status;
    }
    expect(status).toBe("needs_review");
    expect(await t.nest.get(ExtractionQueue).jobState(contract.id)).toBe("completed");
  });
});

describe("confirm", () => {
  async function contractInReview(): Promise<string> {
    const contract = await uploadContract();
    await (
      await processor(answering(FLAT_EXTRACTION))
    ).process(contract.id, {
      isLastAttempt: false,
    });
    return contract.id;
  }

  it("creates a terms version linked to the contract, and the settlement computes from it", async () => {
    const contractId = await contractInReview();
    await t.upload(`/shows/${showId}/ticket-sales/import`, "s.csv", TICKET_SALES_CSV, "text/csv");

    const { status, body } = await t.request<TermsDto>(
      "POST",
      `/contracts/${contractId}/confirm`,
      FLAT_TERMS,
    );

    expect(status).toBe(201);
    expect(body.latest).toMatchObject({ version: 1, contractId, terms: FLAT_TERMS });
    expect((await getContract(contractId)).status).toBe("confirmed");
    const confirmed = await t.prisma.auditLog.findFirstOrThrow({
      where: { action: "contract.confirmed" },
    });
    expect(confirmed.after).toMatchObject({ status: "confirmed", reviewerEdited: false });

    const view = await t.request<SettlementViewDto>("POST", `/shows/${showId}/settlement/compute`);
    expect(view.body.settlement?.payoutCents).toBe(1_000_000);
  });

  it("does not count a different list order as a reviewer edit (regression)", async () => {
    // Claude lists categories in contract order; the review form always sends
    // them in enum order. Same terms, so reviewerEdited must be false.
    const versus = structuredClone(FLAT_EXTRACTION);
    versus.deal.type.value = "versus";
    versus.deal.artistShare = { value: "80%", evidence: quote("80% of net receipts") };
    versus.expensePolicy.allowedCategories = {
      value: ["security", "production"],
      evidence: quote("security and production"),
    };
    const contract = await uploadContract();
    await (await processor(answering(versus))).process(contract.id, { isLastAttempt: false });

    await t.request("POST", `/contracts/${contract.id}/confirm`, {
      ...FLAT_TERMS,
      deal: { type: "versus", guaranteeCents: 1_000_000, artistShareBps: 8000, clauseRef: "§3" },
      expensePolicy: { ...FLAT_TERMS.expensePolicy, allowedCategories: ["production", "security"] },
    });

    const confirmed = await t.prisma.auditLog.findFirstOrThrow({
      where: { action: "contract.confirmed" },
    });
    expect(confirmed.after).toMatchObject({ reviewerEdited: false });
  });

  it("records when the reviewer changed what Claude extracted", async () => {
    const contractId = await contractInReview();
    const edited = structuredClone(FLAT_TERMS);
    edited.deal = { type: "flat", guaranteeCents: 1_200_000, clauseRef: "§3" };

    await t.request("POST", `/contracts/${contractId}/confirm`, edited);

    const confirmed = await t.prisma.auditLog.findFirstOrThrow({
      where: { action: "contract.confirmed" },
    });
    expect(confirmed.after).toMatchObject({ reviewerEdited: true });
  });

  it("refuses to confirm twice, or before extraction, and writes nothing", async () => {
    const contractId = await contractInReview();
    await t.request("POST", `/contracts/${contractId}/confirm`, FLAT_TERMS);
    const again = await t.request("POST", `/contracts/${contractId}/confirm`, FLAT_TERMS);
    expect(again.status).toBe(409);

    const fresh = await uploadContract();
    const early = await t.request("POST", `/contracts/${fresh.id}/confirm`, FLAT_TERMS);
    expect(early.status).toBe(409);

    expect(await t.prisma.contractTerms.count()).toBe(1);
  });

  it("validates the reviewed terms like hand-entered terms (400)", async () => {
    const contractId = await contractInReview();
    const { status } = await t.request("POST", `/contracts/${contractId}/confirm`, {
      ...FLAT_TERMS,
      deal: { type: "versus", guaranteeCents: 1_000_000, clauseRef: "§3" }, // no share
    });
    expect(status).toBe(400);
    expect((await getContract(contractId)).status).toBe("needs_review");
  });

  it("marks an already computed settlement stale", async () => {
    await t.request("POST", `/shows/${showId}/terms`, FLAT_TERMS);
    await t.request("POST", `/shows/${showId}/settlement/compute`);
    const contractId = await contractInReview();

    await t.request("POST", `/contracts/${contractId}/confirm`, FLAT_TERMS);

    const view = await t.request<SettlementViewDto>("GET", `/shows/${showId}/settlement`);
    expect(view.body.settlement?.status).toBe("stale");
  });
});

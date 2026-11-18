import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Contract, PrismaClient } from "@ledgerline/db";
import type { WorkerConfig } from "../../../config.js";
import { SYSTEM_ACTOR_LABEL } from "../../../common/actor.service.js";
import { CONFIG, LLM_CLIENT, PRISMA } from "../../../common/tokens.js";
import type { LlmClient } from "../../llm/llm-client.js";
import { ContractFileStorage } from "../contract-file-storage.js";
import { ContractStateMachine } from "../contract-state-machine.js";
import { ExtractionFailedError, extractContractTerms } from "./extract-contract.js";

export type ProcessOutcome = "extracted" | "failed" | "skipped";

// What one contract-extraction job does. Separate from the BullMQ Worker class,
// so the integration tests can call it directly with a fake LLM.
//
// Safe to run twice for the same contract (a duplicate job, a retry after a
// crash): it re-reads the contract first and does nothing if the work is done.
@Injectable()
export class ExtractionProcessor {
  private readonly logger = new Logger(ExtractionProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ContractStateMachine) private readonly stateMachine: ContractStateMachine,
    @Inject(ContractFileStorage) private readonly storage: ContractFileStorage,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    @Inject(CONFIG) private readonly config: WorkerConfig,
  ) {}

  async process(contractId: string, job: { isLastAttempt: boolean }): Promise<ProcessOutcome> {
    let contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    // "extracting" is a valid start: a crash during the Claude call leaves the
    // contract there, and the retried job must finish it.
    if (!contract || (contract.status !== "uploaded" && contract.status !== "extracting")) {
      this.logger.log(`contract ${contractId}: nothing to do (${contract?.status ?? "not found"})`);
      return "skipped";
    }
    if (contract.status === "uploaded") {
      const uploaded = contract;
      contract = await this.prisma.$transaction((tx) =>
        this.stateMachine.transition(tx, {
          contract: uploaded,
          to: "extracting",
          actor: SYSTEM_ACTOR_LABEL,
          action: "contract.extraction_started",
        }),
      );
    }

    try {
      const pdf = await this.storage.read(contract.fileKey);
      const result = await extractContractTerms(this.llm, {
        pdf,
        model: this.config.llm.extractionModel,
      });
      const extracting = contract;
      await this.prisma.$transaction((tx) =>
        this.stateMachine.transition(tx, {
          contract: extracting,
          to: "needs_review",
          actor: SYSTEM_ACTOR_LABEL,
          action: "contract.extracted",
          data: {
            extractionJson: result.extraction,
            promptVersion: result.promptVersion,
            llmUsage: result.usage,
          },
          details: { attempts: result.attempts, promptVersion: result.promptVersion },
        }),
      );
      return "extracted";
    } catch (error) {
      // The extractor gave up on purpose (invalid output after its retries, a
      // refusal, a truncated reply). Retrying the job would repeat the same bill
      // for the same answer, so this is final: the user uploads again or types
      // the terms in.
      if (error instanceof ExtractionFailedError) {
        const reason = [error.reason, ...error.issues].join("; ");
        await this.markFailed(contract, reason, error.usage);
        return "failed";
      }
      // Anything else (network, database, a missing file) may be temporary:
      // rethrow so BullMQ retries the job. On the last attempt, record the
      // failure first, so the contract does not stay "extracting" forever.
      if (job.isLastAttempt) {
        const message = error instanceof Error ? error.message : String(error);
        await this.markFailed(contract, `error: ${message}`, null);
      }
      throw error;
    }
  }

  private async markFailed(contract: Contract, reason: string, usage: object | null) {
    await this.prisma.$transaction((tx) =>
      this.stateMachine.transition(tx, {
        contract,
        to: "failed",
        actor: SYSTEM_ACTOR_LABEL,
        action: "contract.extraction_failed",
        // Kept short: the reason is shown in the UI and stored in the audit log.
        data: { failureReason: reason.slice(0, 1_000), ...(usage && { llmUsage: usage }) },
        details: { reason: reason.slice(0, 1_000) },
      }),
    );
  }
}

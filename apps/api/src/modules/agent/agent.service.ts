import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { AgentEventDto, AgentRunKind } from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.js";
import { CONFIG, LLM_CLIENT } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";
import type { LlmClient } from "../llm/llm-client.js";
import { toAgentRunDto, toAgentStepDto } from "./agent-dto.js";
import { runAgent, ToolError } from "./agent-loop.js";
import { AGENT_LIMITS, AGENT_PROMPT_VERSION, AGENT_SYSTEM_PROMPT } from "./agent-prompt.js";
import { AgentTraceService } from "./agent-trace.service.js";
import { AuditContextLoader } from "./audit-context-loader.js";
import { ExpenseFlagsService } from "./expense-flags.service.js";
import { buildAuditTools, type AuditContext, type FlagExpense } from "./tools/index.js";

export type PreparedRun = { runId: string; context: AuditContext; question: string };

// Runs the audit agent for a person (F6) and stores its trace (F12). Two steps, so
// the controller can turn the first one's errors into ordinary HTTP errors and only
// then open the event stream:
//   prepare → load the settlement (404/409 if it cannot be audited), start the run
//   run     → the loop; every step is stored, then sent; never throws
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    @Inject(AuditContextLoader) private readonly loader: AuditContextLoader,
    @Inject(AgentTraceService) private readonly traces: AgentTraceService,
    @Inject(ExpenseFlagsService) private readonly flags: ExpenseFlagsService,
  ) {}

  async prepare(
    settlementId: string,
    kind: AgentRunKind,
    question: string,
    actor: Actor,
  ): Promise<PreparedRun> {
    const context = await this.loader.load(settlementId);
    const runId = await this.traces.startRun({
      settlementId,
      settlementVersion: context.settlement.version,
      kind,
      question,
      model: this.config.llm.agentModel,
      promptVersion: AGENT_PROMPT_VERSION,
      startedBy: actor.label,
    });
    return { runId, context, question };
  }

  async run(prepared: PreparedRun, emit: (event: AgentEventDto) => void): Promise<void> {
    const { runId, context, question } = prepared;
    emit({ type: "run_started", runId });
    let position = 0;
    try {
      const result = await runAgent(this.llm, {
        model: this.config.llm.agentModel,
        system: AGENT_SYSTEM_PROMPT,
        tools: buildAuditTools(context, this.flagExpenseFor(runId)),
        question,
        limits: AGENT_LIMITS,
        // Stored first, sent second: what the person saw is always in the trace.
        onStep: async (step) => {
          await this.traces.recordStep(runId, position++, step);
          emit({ type: "step", step: toAgentStepDto(step) });
        },
      });
      await this.traces.finishRun(runId, result);
      emit({ type: "run_finished", run: toAgentRunDto(await this.traces.getRun(runId)) });
    } catch (error) {
      // The API call failed after the SDK's retries, the database went away, or a
      // bug. The detail goes to the log and the run's errorMessage, not the browser.
      this.logger.error(`agent run ${runId} failed`, error instanceof Error ? error.stack : error);
      try {
        await this.traces.failRun(runId, error);
      } catch (failError) {
        this.logger.error(`could not mark agent run ${runId} failed`, failError);
      }
      emit({
        type: "run_failed",
        runId,
        message: "The assistant stopped because of an error. Try again in a moment.",
      });
    }
  }

  // flag_expense for this run: the flag records which run opened it, and the
  // service's "not in this show" refusal becomes an error the model can read.
  private flagExpenseFor(runId: string): FlagExpense {
    return async (input) => {
      try {
        const { flag, created } = await this.flags.flagFromAgentRun({ runId, ...input });
        return { flagId: flag.id, created };
      } catch (error) {
        if (error instanceof NotFoundException) {
          throw new ToolError(error.message);
        }
        throw error;
      }
    };
  }
}

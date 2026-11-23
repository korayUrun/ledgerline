import type { ServerResponse } from "node:http";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from "@nestjs/common";
import {
  AskBodySchema,
  ResolveFlagBodySchema,
  type AgentEventDto,
  type AgentRunDetailDto,
  type AgentRunDto,
  type AskBody,
  type ExpenseFlagDto,
  type ResolveFlagBody,
} from "@ledgerline/schemas";
import { ActorService } from "../../common/actor.service.js";
import { ZodBodyPipe } from "../../common/zod-body.pipe.js";
import { toAgentRunDto, toAgentStepDto, toExpenseFlagDto } from "./agent-dto.js";
import { AUDIT_QUESTION } from "./agent-prompt.js";
import { AgentTraceService } from "./agent-trace.service.js";
import { AgentService, type PreparedRun } from "./agent.service.js";
import { ExpenseFlagsService } from "./expense-flags.service.js";

// The audit agent over HTTP (F6) and its traces (F12). There is no endpoint that
// lets the agent approve or pay: those stay human actions (Phase 5).
@Controller()
export class AgentController {
  constructor(
    @Inject(AgentService) private readonly agent: AgentService,
    @Inject(AgentTraceService) private readonly traces: AgentTraceService,
    @Inject(ExpenseFlagsService) private readonly flags: ExpenseFlagsService,
    @Inject(ActorService) private readonly actors: ActorService,
  ) {}

  // A person's question about the settlement. The answer streams as Server-Sent
  // Events (see stream below).
  @Post("settlements/:settlementId/ask")
  async ask(
    @Param("settlementId", ParseUUIDPipe) settlementId: string,
    @Body(new ZodBodyPipe(AskBodySchema)) body: AskBody,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const actor = await this.actors.current();
    const prepared = await this.agent.prepare(settlementId, "question", body.question, actor);
    await this.stream(response, prepared);
  }

  // "Run audit": the same loop with a fixed question; the agent may open flags.
  @Post("settlements/:settlementId/audit")
  async audit(
    @Param("settlementId", ParseUUIDPipe) settlementId: string,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const actor = await this.actors.current();
    const prepared = await this.agent.prepare(settlementId, "audit", AUDIT_QUESTION, actor);
    await this.stream(response, prepared);
  }

  @Get("settlements/:settlementId/agent-runs")
  async listRuns(
    @Param("settlementId", ParseUUIDPipe) settlementId: string,
  ): Promise<AgentRunDto[]> {
    return (await this.traces.listRuns(settlementId)).map(toAgentRunDto);
  }

  // The replay (F12): the run and every step, in the same shape that streamed live.
  @Get("agent-runs/:runId")
  async getRun(@Param("runId", ParseUUIDPipe) runId: string): Promise<AgentRunDetailDto> {
    const run = await this.traces.getRun(runId);
    const steps = await this.traces.readSteps(runId);
    return { run: toAgentRunDto(run), steps: steps.map(toAgentStepDto) };
  }

  @Get("settlements/:settlementId/flags")
  async listFlags(
    @Param("settlementId", ParseUUIDPipe) settlementId: string,
  ): Promise<ExpenseFlagDto[]> {
    return (await this.flags.listForSettlement(settlementId)).map(toExpenseFlagDto);
  }

  @Post("flags/:flagId/resolve")
  @HttpCode(200)
  async resolveFlag(
    @Param("flagId", ParseUUIDPipe) flagId: string,
    @Body(new ZodBodyPipe(ResolveFlagBodySchema)) body: ResolveFlagBody,
  ): Promise<ExpenseFlagDto> {
    const actor = await this.actors.current();
    return toExpenseFlagDto(await this.flags.resolve(flagId, body.resolution, actor));
  }

  // Server-Sent Events by hand: Nest's @Sse() only serves GET, and a question
  // belongs in a POST body. The format is one "data: <json>" line plus a blank line
  // per event. prepare() already ran, so a 404/409 was a normal JSON error; from
  // here on the status is 200 and errors arrive as a run_failed event.
  private async stream(response: ServerResponse, prepared: PreparedRun): Promise<void> {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    // If the person closes the tab, the run still finishes and is stored (it may
    // be mid-way through a flag). Writing to a closed connection would raise an
    // error event, so events are dropped once it is gone.
    const send = (event: AgentEventDto): void => {
      if (!response.destroyed && !response.writableEnded) {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };
    await this.agent.run(prepared, send);
    response.end();
  }
}

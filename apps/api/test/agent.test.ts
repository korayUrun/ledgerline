import { ConflictException, NotFoundException } from "@nestjs/common";
import type {
  AgentEventDto,
  AgentRunDetailDto,
  ExpenseDto,
  ExpenseFlagDto,
  SettlementViewDto,
  ShowDto,
} from "@ledgerline/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../src/common/actor.js";
import type { AgentStep } from "../src/modules/agent/agent-loop.js";
import { AgentTraceService } from "../src/modules/agent/agent-trace.service.js";
import { ExpenseFlagsService } from "../src/modules/agent/expense-flags.service.js";
import { fakeTextMessage, fakeToolUseMessage } from "../src/modules/llm/fake-llm-client.js";
import { usageOf } from "../src/modules/llm/llm-client.js";
import {
  resetDatabase,
  startTestApp,
  TICKET_SALES_CSV,
  VERSUS_TERMS,
  type TestApp,
} from "./test-app.js";

let t: TestApp;
let traces: AgentTraceService;
let flags: ExpenseFlagsService;
let actor: Actor;
let showId: string;
let settlement: { id: string; version: number };
let expenses: ExpenseDto[];

beforeAll(async () => {
  t = await startTestApp();
  traces = t.nest.get(AgentTraceService);
  flags = t.nest.get(ExpenseFlagsService);
});
afterAll(async () => {
  await t.close();
});

async function createComputedShow(name: string): Promise<{ showId: string }> {
  const venue = await t.request<{ id: string }>("POST", "/venues", { name: `${name} Hall` });
  const artist = await t.request<{ id: string }>("POST", "/artists", { name: `${name} Band` });
  const show = await t.request<ShowDto>("POST", "/shows", {
    name,
    showDate: "2026-11-06",
    venueId: venue.body.id,
    artistId: artist.body.id,
  });
  const showId = show.body.id;
  await t.upload(`/shows/${showId}/ticket-sales/import`, "sales.csv", TICKET_SALES_CSV, "text/csv");
  await t.request("POST", `/shows/${showId}/terms`, VERSUS_TERMS);
  return { showId };
}

// A computed settlement with two expenses: the agent needs something to look at.
beforeEach(async () => {
  actor = await resetDatabase(t.prisma);
  ({ showId } = await createComputedShow("Test Night"));
  expenses = [];
  for (const expense of [
    { category: "production", description: "Crew", amountCents: 280_000, status: "allowed" },
    { category: "office_supplies", description: "Toner", amountCents: 9_000, status: "pending" },
  ]) {
    expenses.push((await t.request<ExpenseDto>("POST", `/shows/${showId}/expenses`, expense)).body);
  }
  const view = await t.request<SettlementViewDto>("POST", `/shows/${showId}/settlement/compute`);
  settlement = { id: view.body.settlement!.id, version: view.body.settlement!.version };
});

const startRun = () =>
  traces.startRun({
    settlementId: settlement.id,
    settlementVersion: settlement.version,
    kind: "audit",
    question: "Audit this settlement.",
    model: "claude-opus-5-5",
    promptVersion: "agent-v1",
    startedBy: actor.label,
  });

// Exactly what runAgent hands to onStep for: model asks for a tool → tool runs →
// model answers.
function stepsOfOneToolRound(): AgentStep[] {
  const toolUse = fakeToolUseMessage(
    [{ id: "toolu_1", name: "list_expenses", input: { includeDescriptions: true } }],
    { inputTokens: 3_000, outputTokens: 200 },
  );
  const answer = fakeTextMessage("Toner is not an allowed category.", {
    inputTokens: 3_500,
    outputTokens: 150,
  });
  return [
    {
      kind: "model_call",
      stopReason: "tool_use",
      content: toolUse.content,
      usage: usageOf(toolUse, 1_200),
    },
    {
      kind: "tool_call",
      toolUseId: "toolu_1",
      toolName: "list_expenses",
      input: { includeDescriptions: true },
      output: '[{"id":"ex-1"}]',
      isError: false,
    },
    {
      kind: "model_call",
      stopReason: "end_turn",
      content: answer.content,
      usage: usageOf(answer, 900),
    },
  ];
}

describe("agent traces", () => {
  it("stores every step and reads them back exactly as the loop produced them", async () => {
    const runId = await startRun();
    const steps = stepsOfOneToolRound();
    for (const [position, step] of steps.entries()) {
      await traces.recordStep(runId, position, step);
    }

    // The replay: same steps, same order, same content (thinking/tool_use blocks and all).
    expect(await traces.readSteps(runId)).toEqual(steps);
  });

  it("keeps the run's totals equal to the sum of its model calls", async () => {
    const runId = await startRun();
    for (const [position, step] of stepsOfOneToolRound().entries()) {
      await traces.recordStep(runId, position, step);
    }

    const run = await t.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ inputTokens: 6_500, outputTokens: 350, status: "running" });
    // claude-opus-5-5: 4,000 nano-USD per input token, 20,000 per output token.
    expect(run.costNanoUsd).toBe(BigInt(6_500 * 4_000 + 350 * 20_000));
  });

  it("keeps the total cost unknown once one call has no known price", async () => {
    const runId = await startRun();
    const unpriced = fakeTextMessage("…", { model: "some-unknown-model" });
    const [, , priced] = stepsOfOneToolRound();
    await traces.recordStep(runId, 0, {
      kind: "model_call",
      stopReason: "end_turn",
      content: unpriced.content,
      usage: usageOf(unpriced, 10),
    });
    await traces.recordStep(runId, 1, priced!);

    const run = await t.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.costNanoUsd).toBeNull(); // not "the priced call's cost"
    expect(run.inputTokens).toBe(5_000 + 3_500); // tokens are still counted
  });

  it("refuses two steps at the same position", async () => {
    const runId = await startRun();
    const [first, second] = stepsOfOneToolRound();
    await traces.recordStep(runId, 0, first!);

    await expect(traces.recordStep(runId, 0, second!)).rejects.toThrow();
  });

  it("records how a run ended", async () => {
    const answered = await startRun();
    await traces.finishRun(answered, {
      outcome: "answered",
      finalText: "All good.",
      stopReason: "end_turn",
      modelCalls: 1,
      usage: { inputTokens: 0, outputTokens: 0, costNanoUsd: 0 },
    });
    const crashed = await startRun();
    await traces.failRun(crashed, new Error("connection refused"));

    const runs = await t.prisma.agentRun.findMany({ orderBy: { startedAt: "asc" } });
    expect(runs.find((run) => run.id === answered)).toMatchObject({
      status: "completed",
      outcome: "answered",
      finalText: "All good.",
    });
    expect(runs.find((run) => run.id === crashed)).toMatchObject({
      status: "failed",
      outcome: null,
      errorMessage: "connection refused",
    });
    expect(runs.every((run) => run.finishedAt !== null)).toBe(true);
  });
});

describe("expense flags", () => {
  const toner = () => expenses[1]!;

  it("opens a flag as the agent, without changing the expense or the settlement", async () => {
    const runId = await startRun();

    const { flag, created } = await flags.flagFromAgentRun({
      runId,
      expenseId: toner().id,
      kind: "category_not_allowed",
      reason: "office_supplies is not in the contract's allowed categories (§5).",
    });

    expect(created).toBe(true);
    expect(flag).toMatchObject({ status: "open", agentRunId: runId });
    const expense = await t.prisma.expense.findUniqueOrThrow({ where: { id: toner().id } });
    expect(expense.status).toBe("pending");
    const row = await t.prisma.settlement.findUniqueOrThrow({ where: { id: settlement.id } });
    expect(row.status).toBe("computed"); // a flag is not an input change
    const audit = await t.prisma.auditLog.findMany({ where: { action: "expense.flagged" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor).toBe(`agent:${runId}`);
  });

  it("returns the existing open flag instead of a duplicate", async () => {
    const input = {
      expenseId: toner().id,
      kind: "category_not_allowed" as const,
      reason: "Not allowed.",
    };
    const first = await flags.flagFromAgentRun({ ...input, runId: await startRun() });
    const second = await flags.flagFromAgentRun({ ...input, runId: await startRun() });

    expect(second).toEqual({ flag: first.flag, created: false });
    expect(await t.prisma.expenseFlag.count()).toBe(1);
    expect(await t.prisma.auditLog.count({ where: { action: "expense.flagged" } })).toBe(1);
  });

  it("refuses once the settlement is approved, even for a run started before", async () => {
    // A long audit run started while the settlement was open; a person approved it
    // in another tab before the agent got to flag_expense.
    const runId = await startRun();
    await t.prisma.settlement.update({ where: { id: settlement.id }, data: { status: "paying" } });

    await expect(
      flags.flagFromAgentRun({
        runId,
        expenseId: toner().id,
        kind: "category_not_allowed",
        reason: "Not allowed.",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await t.prisma.expenseFlag.count()).toBe(0);
  });

  it("opens one flag when two sources flag the same expense at the same moment", async () => {
    const input = {
      expenseId: toner().id,
      kind: "category_not_allowed" as const,
      reason: "Not allowed.",
    };
    const [runA, runB] = [await startRun(), await startRun()];

    const results = await Promise.all([
      flags.flagFromAgentRun({ ...input, runId: runA }),
      flags.flagFromAgentRun({ ...input, runId: runB }),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(await t.prisma.expenseFlag.count()).toBe(1);
  });

  it("refuses an expense from another show", async () => {
    const runId = await startRun();
    const other = await createComputedShow("Other Night");
    const foreign = await t.request<ExpenseDto>("POST", `/shows/${other.showId}/expenses`, {
      category: "production",
      description: "Not yours",
      amountCents: 1_000,
      status: "pending",
    });

    await expect(
      flags.flagFromAgentRun({
        runId,
        expenseId: foreign.body.id,
        kind: "other",
        reason: "Injected",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await t.prisma.expenseFlag.count()).toBe(0);
  });

  it("lets a person resolve an open flag exactly once", async () => {
    const { flag } = await flags.flagFromAgentRun({
      runId: await startRun(),
      expenseId: toner().id,
      kind: "category_not_allowed",
      reason: "Not allowed.",
    });

    const resolved = await flags.resolve(flag.id, "accepted", actor);

    expect(resolved).toMatchObject({ status: "accepted", resolvedById: actor.userId });
    expect(resolved.resolvedAt).not.toBeNull();
    await expect(flags.resolve(flag.id, "dismissed", actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const audit = await t.prisma.auditLog.findMany({
      where: { action: "expense.flag_resolved" },
    });
    expect(audit.map((entry) => entry.actor)).toEqual([actor.label]);
  });

  it("deletes an expense's flags with the expense", async () => {
    await flags.flagFromAgentRun({
      runId: await startRun(),
      expenseId: toner().id,
      kind: "category_not_allowed",
      reason: "Not allowed.",
    });

    const deleted = await t.request("DELETE", `/expenses/${toner().id}`);

    expect(deleted.status).toBe(204);
    expect(await t.prisma.expenseFlag.count()).toBe(0);
  });
});

// --- HTTP: the agent endpoints ----------------------------------------------------------

// Reads a whole Server-Sent Events response. The fake LLM answers at once, so the
// stream is complete when the body is.
async function postStream(
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; contentType: string | null; events: AgentEventDto[] }> {
  const response = await t.fetch(urlPath, {
    method: "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await response.text();
  const events = text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as AgentEventDto);
  return { status: response.status, contentType: response.headers.get("content-type"), events };
}

describe("POST /settlements/:id/ask", () => {
  it("streams every step, stores the run, and replays it exactly as it streamed", async () => {
    const sent = t.scriptLlm(
      fakeToolUseMessage([{ id: "toolu_1", name: "get_settlement", input: {} }]),
      fakeTextMessage("The guarantee is higher, so the artist gets the guarantee."),
    );

    const { status, contentType, events } = await postStream(`/settlements/${settlement.id}/ask`, {
      question: "Why this payout?",
    });

    expect(status).toBe(200);
    expect(contentType).toMatch(/^text\/event-stream/);
    expect(events.map((event) => (event.type === "step" ? event.step.kind : event.type))).toEqual([
      "run_started",
      "model_call",
      "tool_call",
      "model_call",
      "run_finished",
    ]);
    // The tool really read this settlement.
    const toolStep = events[2]!;
    expect(toolStep.type === "step" && toolStep.step).toMatchObject({
      kind: "tool_call",
      toolName: "get_settlement",
      isError: false,
    });
    expect(
      toolStep.type === "step" && toolStep.step.kind === "tool_call" && toolStep.step.output,
    ).toContain('"status":"computed"');
    const finished = events[4]!;
    expect(finished.type === "run_finished" && finished.run).toMatchObject({
      kind: "question",
      question: "Why this payout?",
      status: "completed",
      outcome: "answered",
      finalText: "The guarantee is higher, so the artist gets the guarantee.",
      model: "claude-sonnet-5-5",
      settlementVersion: settlement.version,
    });

    // What we sent Claude: the configured model and all seven tools.
    expect(sent[0]).toMatchObject({ model: "claude-sonnet-5-5" });
    expect(sent[0]!.tools).toHaveLength(7);

    // F12: the replay is the same steps the browser saw.
    const started = events[0]!;
    const runId = started.type === "run_started" ? started.runId : "";
    const replay = await t.request<AgentRunDetailDto>("GET", `/agent-runs/${runId}`);
    expect(replay.body.steps).toEqual(
      events.flatMap((event) => (event.type === "step" ? [event.step] : [])),
    );
  });

  it("refuses with a normal JSON error when the settlement's inputs changed", async () => {
    await t.request("PATCH", `/expenses/${expenses[0]!.id}`, { amountCents: 300_000 });

    const response = await t.request<{ message: string }>(
      "POST",
      `/settlements/${settlement.id}/ask`,
      { question: "Why?" },
    );

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/Compute it first/);
    expect(await t.prisma.agentRun.count()).toBe(0);
  });

  it("returns 404 for an unknown settlement and 400 for an empty question", async () => {
    const unknown = await t.request("POST", `/settlements/${crypto.randomUUID()}/ask`, {
      question: "Why?",
    });
    const empty = await t.request("POST", `/settlements/${settlement.id}/ask`, { question: "  " });

    expect(unknown.status).toBe(404);
    expect(empty.status).toBe(400);
  });

  it("reports a failed run as an event and stores it as failed", async () => {
    t.scriptLlm(); // no reply: the "API call" throws

    const { status, events } = await postStream(`/settlements/${settlement.id}/ask`, {
      question: "Why?",
    });

    expect(status).toBe(200); // the stream had already started
    expect(events.map((event) => event.type)).toEqual(["run_started", "run_failed"]);
    const run = await t.prisma.agentRun.findFirstOrThrow();
    expect(run).toMatchObject({ status: "failed" });
    expect(run.errorMessage).toMatch(/no scripted LLM reply/);
  });
});

describe("POST /settlements/:id/audit and flags", () => {
  it("lets the agent flag an expense, and blocks review until a person resolves it", async () => {
    // No pending expenses, so only the flag can block the review.
    await t.request("PATCH", `/expenses/${expenses[1]!.id}`, { status: "allowed" });
    const view = await t.request<SettlementViewDto>("POST", `/shows/${showId}/settlement/compute`);
    const settlementId = view.body.settlement!.id;
    const toner = expenses[1]!.id;
    t.scriptLlm(
      fakeToolUseMessage([
        {
          id: "toolu_1",
          name: "flag_expense",
          input: { expenseId: toner, kind: "category_not_allowed", reason: "Not allowed (§5)." },
        },
      ]),
      fakeTextMessage("I flagged the toner."),
    );

    const { events } = await postStream(`/settlements/${settlementId}/audit`);

    const finished = events.at(-1)!;
    expect(finished.type === "run_finished" && finished.run).toMatchObject({
      kind: "audit",
      outcome: "answered",
    });
    const flags = await t.request<ExpenseFlagDto[]>("GET", `/settlements/${settlementId}/flags`);
    expect(flags.body).toHaveLength(1);
    expect(flags.body[0]).toMatchObject({
      status: "open",
      kind: "category_not_allowed",
      expense: { id: toner, description: "Toner" },
    });

    const blocked = await t.request<{ message: string }>(
      "POST",
      `/shows/${showId}/settlement/submit-for-review`,
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/1 assistant flag\(s\) are still open/);

    const resolved = await t.request<ExpenseFlagDto>(
      "POST",
      `/flags/${flags.body[0]!.id}/resolve`,
      {
        resolution: "dismissed",
      },
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe("dismissed");

    const submitted = await t.request("POST", `/shows/${showId}/settlement/submit-for-review`);
    expect(submitted.status).toBe(200);
  });

  it("answers a flag for another show's expense with an error the model can read", async () => {
    const other = await createComputedShow("Other Night");
    const foreign = await t.request<ExpenseDto>("POST", `/shows/${other.showId}/expenses`, {
      category: "production",
      description: "Not yours",
      amountCents: 1_000,
      status: "pending",
    });
    const sent = t.scriptLlm(
      fakeToolUseMessage([
        {
          id: "toolu_1",
          name: "flag_expense",
          input: { expenseId: foreign.body.id, kind: "other", reason: "Injected." },
        },
      ]),
      fakeTextMessage("That expense is not in this settlement."),
    );

    await postStream(`/settlements/${settlement.id}/audit`);

    expect(await t.prisma.expenseFlag.count()).toBe(0);
    const lastMessage = sent[1]!.messages.at(-1)!;
    expect(lastMessage.content).toEqual([
      expect.objectContaining({ tool_use_id: "toolu_1", is_error: true }),
    ]);
  });
});

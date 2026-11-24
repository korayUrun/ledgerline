import type {
  AgentEventDto,
  AgentRunDetailDto,
  AgentRunDto,
  CreatedApiKeyDto,
  ShowDto,
} from "@ledgerline/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeTextMessage, fakeToolUseMessage } from "../src/modules/llm/fake-llm-client.js";
import { resetDatabase, startTestApp, TICKET_SALES_CSV, type TestApp } from "./test-app.js";

// The workspace assistant (the Assistant page): a question about any show, answered
// from two read-only tools, streamed like the audit agent and stored as a trace that
// belongs to no settlement.

let t: TestApp;
let showId: string;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

// A show with ticket sales and nothing else: step 2 (the contract) is next.
beforeEach(async () => {
  await resetDatabase(t.prisma);
  const venue = await t.request<{ id: string }>("POST", "/venues", { name: "Harbor Hall" });
  const artist = await t.request<{ id: string }>("POST", "/artists", { name: "The Lanterns" });
  const show = await t.request<ShowDto>("POST", "/shows", {
    name: "Lanterns — Spring Tour",
    showDate: "2026-11-06",
    venueId: venue.body.id,
    artistId: artist.body.id,
  });
  showId = show.body.id;
  await t.upload(`/shows/${showId}/ticket-sales/import`, "sales.csv", TICKET_SALES_CSV, "text/csv");
});

async function ask(question: string): Promise<{ status: number; events: AgentEventDto[] }> {
  const response = await t.fetch("/assistant/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const text = await response.text();
  const events = text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as AgentEventDto);
  return { status: response.status, events };
}

describe("POST /assistant/ask", () => {
  it("finds the show, reads its progress and answers, with a trace that has no settlement", async () => {
    const sent = t.scriptLlm(
      fakeToolUseMessage([{ id: "toolu_1", name: "list_shows", input: { search: "lanterns" } }]),
      fakeToolUseMessage([{ id: "toolu_2", name: "get_show_progress", input: { showId } }]),
      fakeTextMessage("Lanterns — Spring Tour is on Step 2 of 4: Contract."),
    );

    const { status, events } = await ask("Where are we with the Lanterns show?");

    expect(status).toBe(200);
    const finished = events.at(-1)!;
    expect(finished.type === "run_finished" && finished.run).toMatchObject({
      kind: "workspace",
      outcome: "answered",
      settlementId: null,
      settlementVersion: null,
      finalText: "Lanterns — Spring Tour is on Step 2 of 4: Contract.",
    });

    // The model only ever had the two read-only tools: nothing that flags or changes.
    expect(sent[0]!.tools!.map((tool) => ("name" in tool ? tool.name : ""))).toEqual([
      "list_shows",
      "get_show_progress",
    ]);

    // What the tools gave back was decided by the code, from the database.
    const toolOutputs = events.flatMap((event) =>
      event.type === "step" && event.step.kind === "tool_call" ? [event.step] : [],
    );
    expect(JSON.parse(toolOutputs[0]!.output)).toMatchObject({
      matching: 1,
      shows: [{ showId, currentStep: "Step 2 of 4: Contract" }],
    });
    expect(JSON.parse(toolOutputs[1]!.output)).toMatchObject({
      currentStep: 2,
      nextAction: "Upload the contract PDF, or enter the deal terms by hand.",
      facts: { ticketTiers: 2, settlement: null },
    });
  });

  it("lists recent conversations, and each one replays", async () => {
    t.scriptLlm(fakeTextMessage("You have one show."));
    await ask("How many shows do I have?");

    const runs = await t.request<AgentRunDto[]>("GET", "/assistant/runs");
    expect(runs.body).toHaveLength(1);
    expect(runs.body[0]).toMatchObject({
      kind: "workspace",
      question: "How many shows do I have?",
    });

    const replay = await t.request<AgentRunDetailDto>("GET", `/agent-runs/${runs.body[0]!.id}`);
    expect(replay.body.steps.map((step) => step.kind)).toEqual(["model_call"]);
  });

  it("refuses an empty question, and refuses API keys: it is for a logged-in person", async () => {
    const empty = await t.request("POST", "/assistant/ask", { question: " " });
    const key = await t.request<CreatedApiKeyDto>("POST", "/api-keys", { name: "MCP" });
    const withKey = await t.request(
      "POST",
      "/assistant/ask",
      { question: "Where are we?" },
      { authorization: `Bearer ${key.body.key}` },
    );

    expect(empty.status).toBe(400);
    expect(withKey.status).toBe(401);
    expect(await t.prisma.agentRun.count()).toBe(0);
  });
});

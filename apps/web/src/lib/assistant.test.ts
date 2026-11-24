import type { AgentRunDto, AgentStepDto, SettlementStatus, ShowDto } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import {
  assistantHref,
  buildSuggestions,
  QUESTION_MAX_LENGTH,
  readAssistantParams,
  runOutcome,
  showQuestion,
  splitAnswer,
} from "./assistant";

const RUN_ID = "3321fa10-5c2b-4a1c-8a9d-647bf36084d2";

function show(name: string, settlementStatus: SettlementStatus | null): ShowDto {
  return {
    id: name,
    name,
    showDate: "2026-11-06",
    venue: { id: "v1", name: "The Velvet Room" },
    artist: { id: "a1", name: "The Harbor Lights", stripeAccountId: null },
    settlementStatus,
  };
}

function run(fields: Partial<AgentRunDto>): AgentRunDto {
  return {
    id: RUN_ID,
    settlementId: null,
    settlementVersion: null,
    kind: "workspace",
    question: "Which shows need action?",
    model: "fake",
    promptVersion: "workspace-v1",
    status: "completed",
    outcome: "answered",
    finalText: "All done.",
    inputTokens: 0,
    outputTokens: 0,
    costNanoUsd: null,
    startedAt: "2026-11-24T10:00:00.000Z",
    finishedAt: "2026-11-24T10:00:02.000Z",
    ...fields,
  };
}

const toolStep: AgentStepDto = {
  kind: "tool_call",
  toolName: "list_shows",
  input: {},
  output: "[]",
  isError: false,
};

function modelStep(text: string, stopReason: string): AgentStepDto {
  return { kind: "model_call", text, stopReason, inputTokens: 0, outputTokens: 0 };
}

describe("readAssistantParams", () => {
  it("reads the question and a run id", () => {
    expect(readAssistantParams({ q: "  Where are we?  ", run: RUN_ID })).toEqual({
      question: "Where are we?",
      runId: RUN_ID,
    });
  });

  it("ignores a run id that is not a UUID, and repeated parameters", () => {
    expect(readAssistantParams({ q: ["a", "b"], run: "../shows" })).toEqual({
      question: "",
      runId: null,
    });
  });

  it("cuts a question to the length the API accepts", () => {
    const { question } = readAssistantParams({ q: "x".repeat(QUESTION_MAX_LENGTH + 10) });
    expect(question).toHaveLength(QUESTION_MAX_LENGTH);
  });
});

describe("assistantHref", () => {
  it("encodes the question and leaves the bare page without parameters", () => {
    expect(assistantHref({ question: "Where are we with A & B?" })).toBe(
      "/assistant?q=Where+are+we+with+A+%26+B%3F",
    );
    expect(assistantHref({ runId: RUN_ID })).toBe(`/assistant?run=${RUN_ID}`);
    expect(assistantHref({})).toBe("/assistant");
  });

  it("round-trips through readAssistantParams", () => {
    const href = assistantHref({ question: "What is left — before payment?" });
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(readAssistantParams(params).question).toBe("What is left — before payment?");
  });
});

describe("showQuestion", () => {
  it("names the show and its date", () => {
    expect(showQuestion(show("The Harbor Lights — Fall Tour", "computed"))).toBe(
      "Where are we with The Harbor Lights — Fall Tour on Nov 6, 2026?",
    );
  });
});

describe("buildSuggestions", () => {
  it("uses the newest unpaid show and the newest other show already under way", () => {
    const shows = [
      show("Stripe Drill", "paid"),
      show("Static Bloom", null),
      show("Mara Quinn", null),
      show("The Harbor Lights", "computed"),
    ];
    expect(buildSuggestions(shows)).toEqual([
      "Which shows need action?",
      "Where are we with Static Bloom?",
      "What is left before The Harbor Lights can be paid?",
    ]);
  });

  it("falls back to general questions when no show fits", () => {
    expect(buildSuggestions([show("Stripe Drill", "paid")])).toEqual([
      "Which shows need action?",
      "Which shows were paid most recently?",
      "Which shows are waiting for payment?",
    ]);
    expect(buildSuggestions([])).toHaveLength(3);
  });
});

describe("splitAnswer", () => {
  it("takes the final end_turn text as the answer and keeps the rest as the trail", () => {
    const steps = [
      modelStep("", "tool_use"),
      toolStep,
      modelStep("Two shows need action.", "end_turn"),
    ];
    expect(splitAnswer(steps)).toEqual({
      answer: "Two shows need action.",
      trail: [modelStep("", "tool_use"), toolStep],
    });
  });

  it("has no answer while the run is still on its tools, or when it stopped early", () => {
    expect(splitAnswer([modelStep("", "tool_use"), toolStep])).toEqual({
      answer: null,
      trail: [modelStep("", "tool_use"), toolStep],
    });
    expect(splitAnswer([modelStep("Cut", "max_tokens")]).answer).toBeNull();
    expect(splitAnswer([])).toEqual({ answer: null, trail: [] });
  });
});

describe("runOutcome", () => {
  it("says in a word how each run ended", () => {
    expect(runOutcome(run({}))).toEqual({ badge: "answered", label: "Answered" });
    expect(runOutcome(run({ outcome: "step_limit", finalText: null })).badge).toBe("stopped");
    expect(runOutcome(run({ status: "failed", outcome: null })).badge).toBe("failed");
    expect(runOutcome(run({ status: "running", outcome: null })).badge).toBe("running");
  });
});

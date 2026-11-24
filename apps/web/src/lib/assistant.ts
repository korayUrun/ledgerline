import type { AgentRunDto, AgentStepDto, ShowDto } from "@ledgerline/schemas";
import type { SearchParams } from "./flash";
import { formatShowDate } from "./format";

// The Assistant page (docs/SYSTEM.md §7.4): what it reads from the URL, the links
// into it, the suggested questions, and how one run is shown. All pure (no fetch, no
// clock), so the page stays a server component and the tests need no browser. No
// money here: the assistant's answer is text the API wrote, shown as it is.

// The same limit as AskBodySchema: a longer ?q= would only be refused by the API.
export const QUESTION_MAX_LENGTH = 2_000;

// Run ids are UUIDs. Anything else in ?run= is ignored rather than sent to the API.
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AssistantParams = {
  question: string; // ?q=: pre-fills the composer, never sent by itself (asking costs money)
  runId: string | null; // ?run=: a past run to replay in the chat
};

export function readAssistantParams(searchParams: SearchParams): AssistantParams {
  const q = searchParams["q"];
  const run = searchParams["run"];
  return {
    question: typeof q === "string" ? q.trim().slice(0, QUESTION_MAX_LENGTH) : "",
    runId: typeof run === "string" && RUN_ID.test(run) ? run : null,
  };
}

export function assistantHref(params: Partial<AssistantParams>): string {
  const query = new URLSearchParams();
  if (params.question) query.set("q", params.question);
  if (params.runId) query.set("run", params.runId);
  const text = query.toString();
  return text ? `/assistant?${text}` : "/assistant";
}

// The question a show page offers to ask. The date tells two shows with one name apart.
export function showQuestion(show: ShowDto): string {
  return `Where are we with ${show.name} on ${formatShowDate(show.showDate)}?`;
}

// The chips on an empty chat. One general question, then two about real shows from
// GET /shows, so they work on whatever data is loaded: the newest show not paid yet,
// and the newest other one whose settlement has started (so "what is left" has
// something to answer). A general question takes a missing show's place.
export function buildSuggestions(shows: readonly ShowDto[]): string[] {
  const suggestions = ["Which shows need action?"];
  const unpaid = shows.filter((show) => show.settlementStatus !== "paid");
  const newest = unpaid[0];
  const started = unpaid.find((show) => show !== newest && show.settlementStatus !== null);
  suggestions.push(
    newest ? `Where are we with ${newest.name}?` : "Which shows were paid most recently?",
  );
  suggestions.push(
    started
      ? `What is left before ${started.name} can be paid?`
      : "Which shows are waiting for payment?",
  );
  return suggestions;
}

// Splits a run's steps into the answer and the trail behind it ("How I found this").
// The answer is the final model call that ended the turn (stop_reason end_turn): its
// text is the run's finalText. Everything before it, the tool calls and any text the
// model wrote on the way, is the trail. Works on a live run too: until the last step
// arrives there is no answer yet. A run that stopped early has no answer at all.
export function splitAnswer(steps: readonly AgentStepDto[]): {
  answer: string | null;
  trail: AgentStepDto[];
} {
  const last = steps.at(-1);
  if (last?.kind === "model_call" && last.stopReason === "end_turn" && last.text) {
    return { answer: last.text, trail: steps.slice(0, -1) };
  }
  return { answer: null, trail: [...steps] };
}

// A run's outcome in one word for the history list. The word is the badge's text and
// its class picks the tone, so the outcome is never told by color alone.
export type RunOutcome = { badge: "answered" | "stopped" | "failed" | "running"; label: string };

export function runOutcome(run: AgentRunDto): RunOutcome {
  if (run.status === "running") return { badge: "running", label: "Running" };
  if (run.status === "failed") return { badge: "failed", label: "Failed" };
  if (run.outcome === "answered") return { badge: "answered", label: "Answered" };
  return { badge: "stopped", label: "No answer" };
}

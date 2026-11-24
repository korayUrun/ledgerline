"use client";

import type { AgentRunDto, AgentStepDto } from "@ledgerline/schemas";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { QUESTION_MAX_LENGTH, splitAnswer } from "../../lib/assistant";
import { postForEvents } from "../../lib/sse";
import { AgentSteps, RunSummary } from "../agent-steps";
import { SparkleIcon } from "../icons";

// One question and what came back. A replayed run arrives complete from the server;
// a live one fills in as the events stream (docs/SYSTEM.md §7.3).
type Turn = {
  key: number;
  question: string;
  steps: AgentStepDto[];
  run: AgentRunDto | null;
  error: string | null;
  running: boolean;
  askedAt: string | null; // a replay's "Asked …" line, formatted on the server
};

export type ReplayTurn = {
  question: string;
  steps: AgentStepDto[];
  run: AgentRunDto;
  askedAt: string;
};

// The chat on the Assistant page. A client component because it reads the event
// stream as it arrives; the history list and the replay are loaded by the server page.
// Each question is its own run on the API (the assistant keeps no memory between
// them), so the hint under the box asks for the show's name every time.
export function AssistantChat({
  initialQuestion,
  suggestions,
  replay,
}: {
  initialQuestion: string;
  suggestions: string[];
  replay: ReplayTurn | null;
}) {
  const router = useRouter();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const nextKey = useRef(1);
  const [question, setQuestion] = useState(initialQuestion);
  const [running, setRunning] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(
    replay ? [{ key: 0, ...replay, error: null, running: false }] : [],
  );

  // Changes one turn by its key: events for a turn keep arriving while the person
  // may already be reading it, so it is updated in place, never replaced by index.
  function update(key: number, change: (turn: Turn) => Partial<Turn>): void {
    setTurns((previous) =>
      previous.map((turn) => (turn.key === key ? { ...turn, ...change(turn) } : turn)),
    );
  }

  async function ask(text: string): Promise<void> {
    const key = nextKey.current++;
    setTurns((previous) => [
      ...previous,
      { key, question: text, steps: [], run: null, error: null, running: true, askedAt: null },
    ]);
    setQuestion("");
    setRunning(true);
    try {
      const refused = await postForEvents("/assistant/ask", { question: text }, (event) => {
        if (event.type === "step") update(key, (turn) => ({ steps: [...turn.steps, event.step] }));
        if (event.type === "run_finished") update(key, () => ({ run: event.run }));
        if (event.type === "run_failed") update(key, () => ({ error: event.message }));
      });
      if (refused !== null) update(key, () => ({ error: refused }));
    } catch {
      update(key, () => ({
        error:
          "Lost the connection to the assistant. The run may still finish; it will appear under Recent questions.",
      }));
    } finally {
      update(key, () => ({ running: false }));
      setRunning(false);
      // The history list is server-rendered: fetch it again so this question shows up.
      router.refresh();
      // The box was disabled while the run streamed, which drops keyboard focus: put
      // it back where the next question is typed.
      requestAnimationFrame(() => textarea.current?.focus());
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = question.trim();
    if (!text || running) return;
    void ask(text);
  }

  // Enter sends, Shift+Enter starts a new line. Not while an input method is composing
  // (e.g. Japanese), where Enter confirms the characters instead.
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  // A chip only fills the box: asking costs API money, so it is always the Ask
  // button (or Enter) that sends, and the question can still be edited first.
  function pickSuggestion(text: string): void {
    setQuestion(text);
    textarea.current?.focus();
  }

  return (
    <div className="card chat">
      {turns.length === 0 ? (
        <div className="chat-empty">
          <span className="chat-empty-mark" aria-hidden="true">
            <SparkleIcon size={22} />
          </span>
          <p className="chat-empty-title">Ask about any show</p>
          <p className="chat-empty-text">
            Which shows need something from you, where one stands, or what is left before it can be
            paid.
          </p>
          <p className="chat-suggestions-label" id="chat-suggestions-label">
            Try one of these
          </p>
          <ul className="chips chat-suggestions" aria-labelledby="chat-suggestions-label">
            {suggestions.map((text) => (
              <li key={text}>
                <button
                  type="button"
                  className="chip chip-suggestion"
                  onClick={() => pickSuggestion(text)}
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="chat-thread" aria-label="Conversation">
          {turns.map((turn) => (
            <ChatTurn key={turn.key} turn={turn} />
          ))}
        </ol>
      )}

      <form className="chat-composer" onSubmit={submit}>
        <label htmlFor="assistant-question">Your question</label>
        <textarea
          id="assistant-question"
          ref={textarea}
          name="question"
          rows={3}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. Which shows need action?"
          maxLength={QUESTION_MAX_LENGTH}
          disabled={running}
          aria-describedby="assistant-question-hint"
        />
        <div className="chat-composer-foot">
          <p id="assistant-question-hint" className="muted">
            Enter to send, Shift+Enter for a new line. Each question is answered on its own, so name
            the show.
          </p>
          <button type="submit" disabled={running || !question.trim()}>
            {running ? "Thinking…" : "Ask"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChatTurn({ turn }: { turn: Turn }) {
  const { answer, trail } = splitAnswer(turn.steps);
  const toolCalls = trail.filter((step) => step.kind === "tool_call").length;
  // Done, no error, and still no answer: the run hit a limit or was refused.
  // RunSummary below says which.
  const stoppedEarly = !turn.running && turn.error === null && turn.run !== null && !answer;

  return (
    <li className="chat-turn">
      {turn.askedAt && <p className="chat-meta">Replay · asked {turn.askedAt}</p>}
      <p className="chat-question">
        <span className="visually-hidden">You asked: </span>
        {turn.question}
      </p>
      <div className="chat-answer">
        <p className="chat-answer-label">
          <SparkleIcon size={14} />
          Assistant
        </p>
        {/* Polite live region, present from the start so screen readers hear
            "Thinking…" and then the answer when it lands (whole, not word by word). */}
        <div aria-live="polite">
          {turn.running && !answer && <p className="chat-thinking">Thinking…</p>}
          {answer && <div className="agent-message">{answer}</div>}
          {stoppedEarly && (
            <p className="chat-no-answer">The assistant stopped before it had an answer.</p>
          )}
        </div>
        {turn.error && (
          <div className="banner banner-error" role="alert">
            {turn.error}
          </div>
        )}
        {trail.length > 0 && (
          <details className="chat-trail">
            <summary>
              How I found this
              <span className="muted">{toolCalls === 1 ? "1 lookup" : `${toolCalls} lookups`}</span>
            </summary>
            <AgentSteps steps={trail} />
          </details>
        )}
        {turn.run && <RunSummary run={turn.run} />}
      </div>
    </li>
  );
}

"use client";

import type { AgentRunDto, AgentStepDto, ApiErrorDto } from "@ledgerline/schemas";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readEvents } from "../../../../lib/sse";
import { AgentSteps, RunSummary } from "./agent-steps";

// The assistant (F6) next to the worksheet. The only client component on the page:
// it has to read the event stream as it arrives. Requests go to this web server's
// route handlers (/settlements/:id/ask|audit), which pass them on to the API.
export function AssistantPanel({ settlementId }: { settlementId: string }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStepDto[]>([]);
  const [run, setRun] = useState<AgentRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function start(label: string, path: string, body?: unknown): Promise<void> {
    setAsked(label);
    setSteps([]);
    setRun(null);
    setError(null);
    setRunning(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      });
      // Before the stream starts, the API answers errors (404, 409, 400) as JSON.
      if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
        const problem = (await response.json().catch(() => null)) as ApiErrorDto | null;
        setError(problem?.message ?? `The request failed (${response.status}).`);
        return;
      }
      await readEvents(response, (event) => {
        if (event.type === "step") setSteps((previous) => [...previous, event.step]);
        if (event.type === "run_finished") setRun(event.run);
        if (event.type === "run_failed") setError(event.message);
      });
    } catch {
      setError("Lost the connection to the assistant. The run may still finish; reload to see it.");
    } finally {
      setRunning(false);
      // The flags and the run history are server-rendered: fetch them again.
      router.refresh();
    }
  }

  function ask(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    setQuestion("");
    void start(text, `/settlements/${settlementId}/ask`, { question: text });
  }

  return (
    <div className="card assistant">
      <div className="row">
        <button
          type="button"
          disabled={running}
          onClick={() => void start("Audit this settlement", `/settlements/${settlementId}/audit`)}
        >
          Run audit
        </button>
        <span className="muted">
          Checks every expense against the contract and flags problems for you to resolve. It cannot
          approve, pay or change anything.
        </span>
      </div>

      {asked && (
        <div className="agent-run">
          <div className="agent-question">{asked}</div>
          <AgentSteps steps={steps} />
          {running && <p className="muted">Working…</p>}
          {run && <RunSummary run={run} />}
          {error && (
            <div className="banner banner-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}

      <form className="row" onSubmit={ask}>
        <input
          name="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this settlement, e.g. Why is the payout the guarantee?"
          maxLength={2000}
          disabled={running}
          style={{ flex: 1 }}
        />
        <button type="submit" className="secondary" disabled={running || !question.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}

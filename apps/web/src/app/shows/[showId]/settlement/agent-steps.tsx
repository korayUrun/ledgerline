import type { AgentOutcome, AgentRunDto, AgentStepDto } from "@ledgerline/schemas";
import { formatNanoUsd } from "../../../../lib/format";

// One run's steps: the assistant's text, and each tool call it made (folded, with
// the exact input and output). Used by the live chat panel and by the replay page,
// so a stored run looks exactly like it did while it streamed.
export function AgentSteps({ steps }: { steps: AgentStepDto[] }) {
  return (
    <div className="agent-steps">
      {steps.map((step, index) =>
        step.kind === "model_call" ? (
          step.text && (
            <div key={index} className="agent-message">
              {step.text}
            </div>
          )
        ) : (
          <details
            key={index}
            className={step.isError ? "agent-tool agent-tool-error" : "agent-tool"}
          >
            <summary>
              <code>{step.toolName}</code>
              {step.isError && <span className="badge badge-disallowed">error</span>}
            </summary>
            <div className="muted">Input</div>
            <pre>{JSON.stringify(step.input, null, 2)}</pre>
            <div className="muted">Output</div>
            <pre>{prettyJson(step.output)}</pre>
          </details>
        ),
      )}
    </div>
  );
}

// "answered · claude-sonnet-5-5 · 4 calls… · $0.0123", plus why it stopped if it
// did not answer.
export function RunSummary({ run }: { run: AgentRunDto }) {
  const cost = run.costNanoUsd === null ? "cost unknown" : formatNanoUsd(run.costNanoUsd);
  return (
    <p className="muted">
      {run.status === "failed" ? "failed" : OUTCOME_TEXT[run.outcome ?? "answered"]} · {run.model} ·{" "}
      {run.inputTokens.toLocaleString("en-US")} in / {run.outputTokens.toLocaleString("en-US")} out
      tokens · {cost}
    </p>
  );
}

const OUTCOME_TEXT: Record<AgentOutcome, string> = {
  answered: "answered",
  step_limit: "stopped: step limit reached before an answer",
  token_budget: "stopped: token budget used up before an answer",
  truncated: "stopped: the reply was cut off",
  refused: "the model declined to answer",
  unexpected_stop: "stopped unexpectedly",
};

// Tool outputs are JSON text; indented they are much easier to check by eye.
// Error outputs are plain sentences and are shown as they are.
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

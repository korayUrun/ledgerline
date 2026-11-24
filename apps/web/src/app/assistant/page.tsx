import type { AgentRunDetailDto, AgentRunDto, ShowDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api, ApiError } from "../../lib/api";
import {
  assistantHref,
  buildSuggestions,
  readAssistantParams,
  runOutcome,
} from "../../lib/assistant";
import type { SearchParams } from "../../lib/flash";
import { formatDateTime, formatRelativeTime } from "../../lib/format";
import { StatusBadge } from "../components";
import { PageHeader } from "../page-header";
import { AssistantChat, type ReplayTurn } from "./assistant-chat";

// The workspace assistant (docs/SYSTEM.md §7.4): ask about any show, read the answer
// and how it was found. It only reads; approving and paying stay with a person on
// the settlement page. The URL carries the state: ?q= pre-fills the question (never
// sent by itself, asking costs money), ?run= replays a past question in the chat.
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { question, runId } = readAssistantParams(await searchParams);
  const [shows, runs, replayRun] = await Promise.all([
    api.get<ShowDto[]>("/shows"),
    api.get<AgentRunDto[]>("/assistant/runs"),
    runId ? loadRun(runId) : null,
  ]);

  // Formatted here, not in the client component: the server and the browser may sit
  // in different time zones, and the two renders must print the same text.
  const replay: ReplayTurn | null = replayRun && {
    question: replayRun.run.question,
    steps: replayRun.steps,
    run: replayRun.run,
    askedAt: formatDateTime(replayRun.run.startedAt),
  };
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Assistant"
        subtitle="Reads your shows and tells you where each one stands. It cannot change, approve or pay anything."
        actions={
          (runId || question) && (
            <Link href="/assistant" className="button-link secondary">
              New question
            </Link>
          )
        }
      />

      {runId && !replayRun && (
        <div className="banner banner-warn" role="status">
          That question could not be found. Pick one from Recent questions, or ask a new one.
        </div>
      )}

      <div className="assistant-layout">
        <section className="assistant-main" aria-label="Chat">
          {/* A new key per URL: opening another past question (or New question) starts
              a fresh chat, while router.refresh() after an answer keeps this one. */}
          <AssistantChat
            key={runId ?? `q:${question}`}
            initialQuestion={question}
            suggestions={buildSuggestions(shows)}
            replay={replay}
          />
        </section>

        <aside className="card assistant-history" aria-labelledby="recent-questions">
          <h2 id="recent-questions">Recent questions</h2>
          {runs.length === 0 ? (
            <p className="muted">
              Nothing asked yet. Every question is kept with the steps behind its answer, so you can
              read it again here.
            </p>
          ) : (
            <ol className="history-list">
              {runs.map((run) => {
                const outcome = runOutcome(run);
                return (
                  <li key={run.id}>
                    <Link
                      href={assistantHref({ runId: run.id })}
                      aria-current={run.id === runId ? "true" : undefined}
                    >
                      <span className="history-question">{run.question}</span>
                      <span className="history-meta">
                        <time dateTime={run.startedAt}>
                          {formatRelativeTime(run.startedAt, now)}
                        </time>
                        <StatusBadge status={outcome.badge} label={outcome.label} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </div>
    </>
  );
}

// A run id from the URL may be old or mistyped: a 404 (or 400) shows a notice instead
// of the error page. Anything else is a real failure and goes to error.tsx.
async function loadRun(runId: string): Promise<AgentRunDetailDto | null> {
  try {
    return await api.get<AgentRunDetailDto>(`/agent-runs/${encodeURIComponent(runId)}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return null;
    }
    throw error;
  }
}

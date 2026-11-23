import type { AgentRunDetailDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../../../../../lib/api";
import { formatDateTime, humanize } from "../../../../../../lib/format";
import { AgentSteps, RunSummary } from "../../agent-steps";

// F12: the replay of one assistant run, read back from AgentStep. It shows the same
// steps the chat panel showed while the run streamed.
export default async function AgentRunPage({
  params,
}: {
  params: Promise<{ showId: string; runId: string }>;
}) {
  const { showId, runId } = await params;
  const { run, steps } = await api.get<AgentRunDetailDto>(`/agent-runs/${runId}`);

  return (
    <>
      <p className="muted" style={{ marginTop: 16 }}>
        <Link href={`/shows/${showId}/settlement`}>Settlement worksheet</Link> / assistant run
      </p>
      <div className="card assistant">
        <p className="muted">
          {humanize(run.kind)} · {formatDateTime(run.startedAt)} · settlement v
          {run.settlementVersion} · prompt {run.promptVersion}
        </p>
        <div className="agent-question">{run.question}</div>
        <AgentSteps steps={steps} />
        <RunSummary run={run} />
      </div>
    </>
  );
}

import type { ContractUsageDto } from "@ledgerline/schemas";
import { formatNanoUsd } from "../../../../lib/format";

// "claude-opus-5-5 · 1 call · 6,120 in / 1,480 out tokens · $0.0541". Cost is
// integer nano-dollars from the API, turned into text with integer math only.
// Collapsed by default: it is for whoever runs the app, not for checking the deal.
export function UsageNote({ usage }: { usage: ContractUsageDto | null }) {
  if (!usage) return null;
  const cost = usage.costNanoUsd === null ? "cost unknown" : formatNanoUsd(usage.costNanoUsd);
  return (
    <details className="usage-details">
      <summary>Extraction details</summary>
      <p className="muted">
        {usage.model} · {usage.calls} call{usage.calls === 1 ? "" : "s"} ·{" "}
        {usage.inputTokens.toLocaleString("en-US")} in /{" "}
        {usage.outputTokens.toLocaleString("en-US")} out tokens · {cost}
      </p>
    </details>
  );
}

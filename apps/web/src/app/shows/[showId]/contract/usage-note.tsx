import type { ContractUsageDto } from "@ledgerline/schemas";

// "claude-opus-5-5 · 1 call · 6,120 in / 1,480 out tokens · $0.0541". Cost is
// integer nano-dollars from the API, turned into text with integer math only.
export function UsageNote({ usage }: { usage: ContractUsageDto | null }) {
  if (!usage) return null;
  const cost = usage.costNanoUsd === null ? "cost unknown" : formatNanoUsd(usage.costNanoUsd);
  return (
    <p className="muted">
      {usage.model} · {usage.calls} call{usage.calls === 1 ? "" : "s"} ·{" "}
      {usage.inputTokens.toLocaleString("en-US")} in / {usage.outputTokens.toLocaleString("en-US")}{" "}
      out tokens · {cost}
    </p>
  );
}

// Rounded half up to $0.0001 (100,000 nano-dollars), with integer remainders
// like formatCents. The API has the same helper; web cannot import api code.
function formatNanoUsd(nano: number): string {
  const remainder = nano % 100_000;
  const units = (nano - remainder) / 100_000 + (remainder >= 50_000 ? 1 : 0);
  const fraction = units % 10_000;
  return `$${(units - fraction) / 10_000}.${String(fraction).padStart(4, "0")}`;
}

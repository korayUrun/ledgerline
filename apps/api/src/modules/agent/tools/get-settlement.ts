import { formatCents } from "@ledgerline/schemas";
import { z } from "zod";
import type { AgentTool } from "../agent-loop.js";
import type { AuditContext } from "./audit-context.js";

// No input: there is only one settlement in a run (the context's).
const GetSettlementInputSchema = z.object({});

export function getSettlementTool(
  context: AuditContext,
): AgentTool<typeof GetSettlementInputSchema> {
  return {
    name: "get_settlement",
    description:
      "Returns the settlement being audited: status, version, the artist payout, and every worksheet line in order (position, kind, label, amount, contract clause). Call this first to see how the payout was built. Amounts are dollar text computed by the settlement engine; quote them as they are and never add or subtract them yourself. To see which ticket sales or expenses a line was computed from, call explain_line with its position.",
    inputSchema: GetSettlementInputSchema,
    run() {
      const { settlement, lines } = context;
      return {
        status: settlement.status,
        version: settlement.version,
        termsVersion: settlement.termsVersion,
        computedAt: settlement.computedAt,
        payout: formatCents(settlement.payoutCents),
        lines: lines.map((line, position) => ({
          position,
          kind: line.kind,
          label: line.label,
          amount: formatCents(line.amountCents),
          clauseRef: line.clauseRef,
        })),
      };
    },
  };
}

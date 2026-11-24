import type { ContractStatus, SettlementStatus } from "@ledgerline/schemas";

// What the workspace assistant knows about one show: facts only (counts, statuses),
// read once when a run starts (workspace-context-loader.ts). The tools read this,
// never the database, like the audit agent's AuditContext.
export type WorkspaceShow = {
  id: string;
  name: string;
  showDate: string; // "YYYY-MM-DD", a calendar date
  artistName: string;
  venueName: string;
  ticketTierCount: number;
  expenseCount: number;
  pendingExpenseCount: number;
  openFlagCount: number;
  // The newest upload; null when no contract PDF was uploaded.
  latestContractStatus: ContractStatus | null;
  // The newest confirmed terms version; null when there are no terms yet.
  termsVersion: number | null;
  settlement: {
    status: SettlementStatus;
    version: number;
    payoutCents: number | null; // as the engine computed it; shown, never recomputed
  } | null;
};

export type WorkspaceContext = { shows: WorkspaceShow[] };

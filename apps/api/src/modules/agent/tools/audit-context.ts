import type {
  ContractExtraction,
  ExpenseDto,
  SettlementInput,
  SettlementLine,
  SettlementStatus,
} from "@ledgerline/schemas";

// Everything the audit agent's tools can read, loaded once when a run starts.
// Plain data, no database: the API fills it from Postgres, the eval fills it from a
// dataset case, and the tools cannot tell the difference. It also freezes what the
// agent sees: every tool call in a run answers about the same settlement version.
export type AuditContext = {
  settlement: {
    id: string;
    status: SettlementStatus;
    version: number;
    termsVersion: number;
    payoutCents: number;
    computedAt: string;
  };
  // The engine's input exactly as it was frozen at compute time (inputSnapshot).
  input: SettlementInput;
  // The worksheet the engine produced from `input`, in worksheet order.
  lines: SettlementLine[];
  // The show's expenses WITH their descriptions (the engine input leaves those out).
  // A description is free text anyone can type: data for the agent, never orders.
  expenses: AuditExpense[];
  // What the extraction read from the contract PDF, with a quote for each term.
  // null when the terms were typed in by hand.
  extraction: ContractExtraction | null;
};

export type AuditExpense = Pick<
  ExpenseDto,
  "id" | "category" | "description" | "amountCents" | "status" | "hasReceipt"
>;

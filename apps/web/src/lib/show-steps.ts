import type { ContractStatus, SettlementStatus } from "@ledgerline/schemas";

// From approval on, the API refuses every change to a settlement's inputs (sales,
// expenses, contract, terms): STATUSES_WITH_LOCKED_INPUTS in
// apps/api/src/modules/settlements/settlement-state-machine.ts. The web app cannot
// import api code, so the list is repeated here. The API still decides; the UI only
// stops offering forms that would be refused.
const STATUSES_WITH_LOCKED_INPUTS: readonly SettlementStatus[] = [
  "approved",
  "paying",
  "paid",
  "payment_failed",
];

export function inputsLocked(status: SettlementStatus | null): boolean {
  return status !== null && STATUSES_WITH_LOCKED_INPUTS.includes(status);
}

// What a person reads for each settlement status. Keyed by the enum, so a new status
// fails to compile until it has a label.
export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  draft: "Draft",
  computed: "Computed",
  in_review: "In review",
  stale: "Stale",
  approved: "Approved",
  paying: "Paying",
  paid: "Paid",
  payment_failed: "Payment failed",
};

// The state of one step of the flow, shown in its tab. The tone picks a symbol and a
// color, but the label always says it in words (never color alone).
export type StepTone = "done" | "attention" | "progress" | "todo" | "locked";
export type StepState = { tone: StepTone; label: string };

const DONE: StepState = { tone: "done", label: "Done" };
const NOT_STARTED: StepState = { tone: "todo", label: "Not started" };
const LOCKED: StepState = { tone: "locked", label: "Locked" };

// Step 1. Done once there are ticket sales; expenses are optional (a show can have none).
export function salesStep(ticketSaleCount: number, locked: boolean): StepState {
  if (locked) return LOCKED;
  return ticketSaleCount > 0 ? DONE : NOT_STARTED;
}

// Step 2. Follows the newest upload. Terms typed in by hand also finish this step:
// the contract PDF is one way to get terms, not a requirement.
export function contractStep(
  latestContractStatus: ContractStatus | null,
  hasTerms: boolean,
  locked: boolean,
): StepState {
  if (locked) return LOCKED;
  switch (latestContractStatus) {
    case null:
      return hasTerms ? DONE : NOT_STARTED;
    case "needs_review":
      return { tone: "attention", label: "Needs review" };
    case "confirmed":
      return DONE;
    case "uploaded":
    case "extracting":
      return { tone: "progress", label: "Reading" };
    case "failed":
      return hasTerms ? DONE : { tone: "attention", label: "Failed" };
  }
}

// Step 3. Done once any terms version exists.
export function termsStep(hasTerms: boolean, locked: boolean): StepState {
  if (locked) return LOCKED;
  return hasTerms ? DONE : NOT_STARTED;
}

// Step 4. The settlement's own status, in words.
export function settlementStep(status: SettlementStatus | null): StepState {
  if (status === null) return NOT_STARTED;
  const label = SETTLEMENT_STATUS_LABELS[status];
  switch (status) {
    case "draft":
      return { tone: "todo", label };
    case "paid":
      return { tone: "done", label };
    case "stale":
    case "payment_failed":
      return { tone: "attention", label };
    case "computed":
    case "in_review":
    case "approved":
    case "paying":
      return { tone: "progress", label };
  }
}

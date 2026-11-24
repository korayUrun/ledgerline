import type { SettlementStatus } from "@ledgerline/schemas";
import type { WorkspaceShow } from "./workspace-context.js";

// Where a show is in the four-step flow, and what a person should do next.
//
// Decided here, by code, so the assistant never has to work it out: the model only
// reads this and puts it into words (the same rule as for money: the AI explains,
// the code decides). The web app shows the same steps in its stepper
// (apps/web/src/lib/show-steps.ts); web cannot import api code, so the rules are
// written twice and kept in step by the wording in docs (Guide page).

export type StepState = "done" | "needs_attention" | "in_progress" | "not_started" | "locked";

export type StepProgress = {
  number: 1 | 2 | 3 | 4;
  title: string;
  state: StepState;
};

export type ShowProgress = {
  steps: StepProgress[];
  currentStep: 1 | 2 | 3 | 4;
  nextAction: string;
};

// From approval on, the inputs are locked (SettlementStateMachine).
const LOCKED: readonly SettlementStatus[] = ["approved", "paying", "paid", "payment_failed"];

export function showProgress(show: WorkspaceShow): ShowProgress {
  const settlementStatus = show.settlement?.status ?? null;
  const locked = settlementStatus !== null && LOCKED.includes(settlementStatus);

  const steps: StepProgress[] = [
    { number: 1, title: "Sales & expenses", state: locked ? "locked" : salesState(show) },
    { number: 2, title: "Contract", state: locked ? "locked" : contractState(show) },
    { number: 3, title: "Deal terms", state: locked ? "locked" : termsState(show) },
    { number: 4, title: "Settlement", state: settlementState(show, locked) },
  ];

  // The first step that still needs something; once 1–3 are done (or locked), the
  // settlement step is where the person is.
  const open = steps.find(
    (step) => step.number < 4 && step.state !== "done" && step.state !== "locked",
  );
  return { steps, currentStep: open?.number ?? 4, nextAction: nextAction(show, locked) };
}

function salesState(show: WorkspaceShow): StepState {
  return show.ticketTierCount > 0 ? "done" : "not_started";
}

function contractState(show: WorkspaceShow): StepState {
  switch (show.latestContractStatus) {
    case null:
      // Terms typed in by hand also finish this step: the PDF is one way to get terms.
      return show.termsVersion !== null ? "done" : "not_started";
    case "uploaded":
    case "extracting":
      return "in_progress";
    case "needs_review":
    case "failed":
      return "needs_attention";
    case "confirmed":
      return "done";
  }
}

function termsState(show: WorkspaceShow): StepState {
  return show.termsVersion !== null ? "done" : "not_started";
}

function settlementState(show: WorkspaceShow, locked: boolean): StepState {
  const status = show.settlement?.status ?? null;
  if (status === "paid") return "done";
  if (locked) return status === "payment_failed" ? "needs_attention" : "in_progress";
  if (status === null || status === "draft") return "not_started";
  if (status === "stale") return "needs_attention";
  if (status === "computed" && (show.pendingExpenseCount > 0 || show.openFlagCount > 0)) {
    return "needs_attention";
  }
  return "in_progress"; // computed and ready, or in review
}

function nextAction(show: WorkspaceShow, locked: boolean): string {
  const status = show.settlement?.status ?? null;
  if (locked) {
    if (status === "paid") return "Nothing left to do: the artist has been paid.";
    if (status === "payment_failed") {
      return "The payment failed. Retry it on the Settlement page.";
    }
    return "Wait for Stripe to confirm the payment; the settlement then becomes paid.";
  }
  if (show.ticketTierCount === 0) {
    return "Import the ticket sales CSV on the Sales & expenses step.";
  }
  switch (show.latestContractStatus) {
    case "uploaded":
    case "extracting":
      return "Wait for the contract extraction to finish, then review the terms.";
    case "needs_review":
      return "Review the extracted deal terms against the contract PDF and confirm them.";
    case "failed":
      return "The contract extraction failed. Upload the PDF again, or enter the deal terms by hand.";
    default:
      break;
  }
  if (show.termsVersion === null) {
    return "Upload the contract PDF, or enter the deal terms by hand.";
  }
  if (status === null || status === "draft") return "Compute the settlement.";
  if (status === "stale")
    return "Recompute the settlement: its inputs changed after the last compute.";
  if (status === "computed") {
    if (show.pendingExpenseCount > 0) {
      return `Allow or disallow the ${show.pendingExpenseCount} pending expense(s), then recompute.`;
    }
    if (show.openFlagCount > 0) {
      return `Accept or dismiss the ${show.openFlagCount} open assistant flag(s), then submit for review.`;
    }
    return "Submit the settlement for review.";
  }
  // in_review
  if (show.openFlagCount > 0) {
    return `Accept or dismiss the ${show.openFlagCount} open assistant flag(s) before approving.`;
  }
  return "A person checks the worksheet, then approves and pays on the Settlement page.";
}

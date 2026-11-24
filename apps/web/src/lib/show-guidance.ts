import type { ContractStatus, SettlementStatus } from "@ledgerline/schemas";
import { inputsLocked } from "./show-steps";

// "What to do now": the one sentence at the top of each show page that says what this
// step needs from the person, and the one button that does it. Pure functions of data
// each page already loads, so they are tested without a browser. No money here: only
// counts and statuses decide the text.

// The tone picks a symbol and a color; the card always says it in words too.
export type GuidanceTone = "todo" | "attention" | "waiting" | "done" | "locked";

export type GuidanceAction = { href: string; label: string };

export type Guidance = {
  tone: GuidanceTone;
  message: string;
  detail?: string;
  // The one primary button, always a link. null when the action is a form that already
  // lives on the page (Compute, Import, Confirm…): the message points to it instead,
  // so no server-action form is ever rendered twice.
  action: GuidanceAction | null;
};

export const GUIDANCE_TONE_LABELS: Record<GuidanceTone, string> = {
  todo: "To do",
  attention: "Needs attention",
  waiting: "In progress",
  done: "Done",
  locked: "Locked",
};

// "1 pending expense", "2 pending expenses". Display only.
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const paths = (showId: string) => ({
  sales: `/shows/${showId}`,
  expenses: `/shows/${showId}#expenses`,
  import: `/shows/${showId}/import`,
  contract: `/shows/${showId}/contract`,
  terms: `/shows/${showId}/terms`,
  settlement: `/shows/${showId}/settlement`,
});

// Steps 1 to 3 once the settlement is approved: nothing can change, so the card says
// where the money is and points to the settlement.
export function lockedInputsGuidance(showId: string, status: SettlementStatus): Guidance {
  const detail =
    "Sales, expenses, the contract and the deal terms can be read but no longer changed.";
  const toSettlement = { href: paths(showId).settlement, label: "See the settlement" };
  if (status === "paid") {
    return {
      tone: "locked",
      message: "This settlement is paid and final; nothing is left to do.",
      detail,
      action: toSettlement,
    };
  }
  if (status === "payment_failed") {
    return {
      tone: "locked",
      message: "The settlement is final, but its payout failed. Retry it on the Settlement step.",
      detail,
      action: { href: paths(showId).settlement, label: "Go to the settlement" },
    };
  }
  return {
    tone: "locked",
    message: "The settlement is approved and final; the payout is on its way.",
    detail,
    action: toSettlement,
  };
}

// Step 1: the show page with its sales and expenses.
export function salesGuidance(input: {
  showId: string;
  status: SettlementStatus | null;
  ticketSaleCount: number;
  pendingExpenseCount: number;
}): Guidance {
  const to = paths(input.showId);
  if (input.status !== null && inputsLocked(input.status)) {
    return lockedInputsGuidance(input.showId, input.status);
  }
  if (input.ticketSaleCount === 0) {
    return {
      tone: "todo",
      message: "Import the ticket sales CSV to start.",
      detail: "Expenses can be added below at any time; a show can also have none.",
      action: { href: to.import, label: "Import sales CSV" },
    };
  }
  if (input.pendingExpenseCount > 0) {
    return {
      tone: "attention",
      message: `Decide the ${countOf(input.pendingExpenseCount, "pending expense")}: allow or disallow each one, then save it.`,
      detail: "Pending expenses count in the math as a preview, but they block review.",
      action: { href: "#expenses", label: "Go to the expenses" },
    };
  }
  return {
    tone: "done",
    message: "Sales are in and every expense is decided. This step is done.",
    action: { href: to.contract, label: "Next: Contract" },
  };
}

// Step 1, the CSV import page. Its form is right below the card.
export function importGuidance(input: {
  showId: string;
  status: SettlementStatus | null;
}): Guidance {
  if (input.status !== null && inputsLocked(input.status)) {
    return lockedInputsGuidance(input.showId, input.status);
  }
  return {
    tone: "todo",
    message: "Choose the box office CSV below and import it.",
    detail: "The import replaces this show's current ticket sales.",
    action: null,
  };
}

// Step 2: the contract uploads. Follows the newest upload, like contractStep.
export function contractGuidance(input: {
  showId: string;
  status: SettlementStatus | null;
  latestContract: { id: string; status: ContractStatus } | null;
  hasTerms: boolean;
}): Guidance {
  const to = paths(input.showId);
  if (input.status !== null && inputsLocked(input.status)) {
    return lockedInputsGuidance(input.showId, input.status);
  }
  const nextStep = { href: to.terms, label: "Next: Deal terms" };
  const latest = input.latestContract;
  if (latest === null) {
    return input.hasTerms
      ? {
          tone: "done",
          message: "The deal terms were typed in by hand, so this step is done.",
          detail: "You can still upload the contract PDF below to check them against it.",
          action: nextStep,
        }
      : {
          tone: "todo",
          message: "Upload the artist contract PDF below; Claude extracts the deal terms.",
          detail: "You check every term against its quote before anything is computed.",
          action: null,
        };
  }
  switch (latest.status) {
    case "uploaded":
    case "extracting":
      return {
        tone: "waiting",
        message: "Claude is reading the contract. Nothing to do yet.",
        detail: "This page refreshes by itself until the terms are ready to review.",
        action: null,
      };
    case "needs_review":
      return {
        tone: "attention",
        message: "Review the extracted terms against the PDF and confirm them.",
        action: { href: `${to.contract}/${latest.id}`, label: "Review terms" },
      };
    case "confirmed":
      return {
        tone: "done",
        message: "The contract is reviewed and confirmed. This step is done.",
        action: nextStep,
      };
    case "failed":
      return input.hasTerms
        ? {
            tone: "done",
            message: "Reading the latest upload failed, but deal terms are already in place.",
            action: nextStep,
          }
        : {
            tone: "attention",
            message: "Reading the contract failed. Upload the PDF again, or type the terms in.",
            action: { href: to.terms, label: "Type the terms in" },
          };
  }
}

// Step 2, the review of one upload. The confirm button ends the form on that page.
export function contractReviewGuidance(input: {
  showId: string;
  status: SettlementStatus | null;
  contractStatus: ContractStatus;
}): Guidance {
  const to = paths(input.showId);
  if (input.status !== null && inputsLocked(input.status)) {
    return lockedInputsGuidance(input.showId, input.status);
  }
  switch (input.contractStatus) {
    case "needs_review":
      return {
        tone: "attention",
        message:
          "Check each field against its quote from the PDF, then confirm at the end of the form.",
        detail: "Fill in any field marked as not found if the contract has it.",
        action: null,
      };
    case "confirmed":
      return {
        tone: "done",
        message: "This contract is confirmed. This step is done.",
        action: { href: to.terms, label: "Next: Deal terms" },
      };
    case "uploaded":
    case "extracting":
      return {
        tone: "waiting",
        message: "Claude is still reading this contract. Nothing to review yet.",
        action: { href: to.contract, label: "Back to the contract" },
      };
    case "failed":
      return {
        tone: "attention",
        message: "Reading this contract failed, so there is nothing to confirm.",
        action: { href: to.contract, label: "Back to the contract" },
      };
  }
}

// Step 3: the deal terms.
export function termsGuidance(input: {
  showId: string;
  status: SettlementStatus | null;
  latestVersion: number | null;
}): Guidance {
  const to = paths(input.showId);
  if (input.status !== null && inputsLocked(input.status)) {
    return lockedInputsGuidance(input.showId, input.status);
  }
  if (input.latestVersion === null) {
    return {
      tone: "todo",
      message: "Upload the contract so Claude can extract the terms, or type them in below.",
      action: { href: to.contract, label: "Upload the contract" },
    };
  }
  return {
    tone: "done",
    message: `Terms v${input.latestVersion} are in place. This step is done.`,
    detail: "Change a field below only if the contract says otherwise; saving makes a new version.",
    action: { href: to.settlement, label: "Next: Settlement" },
  };
}

// Step 4: the settlement. The forms (Compute, Submit, Approve, Retry, Connect Stripe)
// sit right under the card, so for those the card has no button of its own.
export function settlementGuidance(input: {
  showId: string;
  status: SettlementStatus | null;
  ticketSaleCount: number;
  hasTerms: boolean;
  pendingExpenseCount: number;
  openFlagCount: number;
  artistName: string;
  artistHasAccount: boolean;
  failureReason: string | null;
}): Guidance {
  const to = paths(input.showId);
  const decidePending: Guidance = {
    tone: "attention",
    message: `Decide the ${countOf(input.pendingExpenseCount, "pending expense")}, then recompute.`,
    detail:
      "They count in the math as a preview, but the settlement cannot go to review until each is allowed or disallowed.",
    action: { href: to.expenses, label: "Decide pending expenses" },
  };
  switch (input.status) {
    case null:
    case "draft":
      if (input.ticketSaleCount === 0) {
        return {
          tone: "todo",
          message: "Import the ticket sales before computing the settlement.",
          action: { href: to.import, label: "Import sales CSV" },
        };
      }
      if (!input.hasTerms) {
        return {
          tone: "todo",
          message: "Confirm the deal terms before computing the settlement.",
          action: { href: to.terms, label: "Go to the deal terms" },
        };
      }
      return {
        tone: "todo",
        message: "Sales and terms are in place. Compute the settlement with the button below.",
        action: null,
      };
    case "stale":
      if (input.pendingExpenseCount > 0) return decidePending;
      return {
        tone: "attention",
        message: "The inputs changed after this was computed. Recompute to update the numbers.",
        detail: "Until then, the payout and worksheet below are the old result.",
        action: null,
      };
    case "computed":
      if (input.pendingExpenseCount > 0) return decidePending;
      if (input.openFlagCount > 0) {
        return {
          tone: "attention",
          message: `Accept or dismiss the ${countOf(input.openFlagCount, "assistant flag")}, then submit for review.`,
          action: { href: "#flags", label: "Go to the flags" },
        };
      }
      return {
        tone: "todo",
        message: "Check the worksheet, then submit it for review with the button below.",
        detail: "Optional: let the assistant audit the expenses first.",
        action: null,
      };
    case "in_review":
      if (!input.artistHasAccount) {
        return {
          tone: "attention",
          message: `Connect a Stripe account for ${input.artistName}, then approve the payout.`,
          detail: "Stripe test mode: fill in the onboarding page with test data.",
          action: null,
        };
      }
      return {
        tone: "todo",
        message: "Check the worksheet, then approve the payout below.",
        detail: "Approving starts the payout and locks the inputs. It cannot be undone.",
        action: null,
      };
    case "approved":
    case "paying":
      return {
        tone: "locked",
        message: "The settlement is approved and final; the payout is on its way.",
        detail: "Nothing to do. The status changes to Paid when Stripe confirms the transfer.",
        action: null,
      };
    case "paid":
      return {
        tone: "locked",
        message: "Paid. This settlement is final; nothing is left to do.",
        action: { href: "/shows", label: "Back to all shows" },
      };
    case "payment_failed":
      return {
        tone: "attention",
        message: input.artistHasAccount
          ? "The payout failed. Fix the cause, then retry the payment below."
          : `The payout failed. Connect a Stripe account for ${input.artistName}, then retry.`,
        detail: `Reason: ${input.failureReason ?? "no reason given"}. A retry is a new attempt with its own key; the settlement itself stays final.`,
        action: null,
      };
  }
}

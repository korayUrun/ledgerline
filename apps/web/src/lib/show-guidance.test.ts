import { describe, expect, it } from "vitest";
import {
  contractGuidance,
  contractReviewGuidance,
  countOf,
  importGuidance,
  lockedInputsGuidance,
  salesGuidance,
  settlementGuidance,
  termsGuidance,
} from "./show-guidance";

const showId = "show-1";

describe("countOf", () => {
  it("says one or many", () => {
    expect(countOf(1, "pending expense")).toBe("1 pending expense");
    expect(countOf(2, "pending expense")).toBe("2 pending expenses");
  });
});

describe("salesGuidance", () => {
  const base = { showId, status: null, ticketSaleCount: 2, pendingExpenseCount: 0 } as const;

  it("asks for the CSV first, with the import page as the button", () => {
    const guidance = salesGuidance({ ...base, ticketSaleCount: 0 });
    expect(guidance.message).toBe("Import the ticket sales CSV to start.");
    expect(guidance.action).toEqual({ href: "/shows/show-1/import", label: "Import sales CSV" });
  });

  it("then asks to decide pending expenses", () => {
    const guidance = salesGuidance({ ...base, pendingExpenseCount: 2 });
    expect(guidance.tone).toBe("attention");
    expect(guidance.message).toContain("2 pending expenses");
    expect(guidance.action?.href).toBe("#expenses");
  });

  it("says done and points to the contract step", () => {
    const guidance = salesGuidance(base);
    expect(guidance.tone).toBe("done");
    expect(guidance.action?.href).toBe("/shows/show-1/contract");
  });

  it("is locked from approval on", () => {
    expect(salesGuidance({ ...base, status: "approved" }).tone).toBe("locked");
    expect(salesGuidance({ ...base, status: "paid" }).message).toContain("final");
  });
});

describe("importGuidance", () => {
  it("points to the form below, without a second button", () => {
    expect(importGuidance({ showId, status: "computed" }).action).toBeNull();
  });

  it("is locked from approval on", () => {
    expect(importGuidance({ showId, status: "paying" }).tone).toBe("locked");
  });
});

describe("contractGuidance", () => {
  const base = { showId, status: null, latestContract: null, hasTerms: false } as const;

  it("asks for the PDF when there is no upload and no terms", () => {
    const guidance = contractGuidance(base);
    expect(guidance.tone).toBe("todo");
    expect(guidance.action).toBeNull();
  });

  it("is done when terms were typed in without a contract", () => {
    expect(contractGuidance({ ...base, hasTerms: true }).tone).toBe("done");
  });

  it("sends a contract that needs review to its review page", () => {
    const guidance = contractGuidance({
      ...base,
      latestContract: { id: "c-9", status: "needs_review" },
    });
    expect(guidance.message).toBe("Review the extracted terms against the PDF and confirm them.");
    expect(guidance.action).toEqual({ href: "/shows/show-1/contract/c-9", label: "Review terms" });
  });

  it("waits while Claude reads", () => {
    const guidance = contractGuidance({
      ...base,
      latestContract: { id: "c-9", status: "extracting" },
    });
    expect(guidance.tone).toBe("waiting");
  });

  it("offers typing the terms in after a failed read, unless terms exist", () => {
    const failed = { id: "c-9", status: "failed" } as const;
    expect(contractGuidance({ ...base, latestContract: failed }).action?.href).toBe(
      "/shows/show-1/terms",
    );
    expect(contractGuidance({ ...base, latestContract: failed, hasTerms: true }).tone).toBe("done");
  });

  it("follows the step state: done once confirmed, locked once approved", () => {
    const confirmed = { id: "c-9", status: "confirmed" } as const;
    expect(contractGuidance({ ...base, latestContract: confirmed }).tone).toBe("done");
    expect(contractGuidance({ ...base, latestContract: confirmed, status: "paid" }).tone).toBe(
      "locked",
    );
  });
});

describe("contractReviewGuidance", () => {
  it("points to the confirm button at the end of the form", () => {
    const guidance = contractReviewGuidance({
      showId,
      status: "computed",
      contractStatus: "needs_review",
    });
    expect(guidance.action).toBeNull();
    expect(guidance.message).toContain("confirm");
  });

  it("is done once confirmed", () => {
    expect(
      contractReviewGuidance({ showId, status: null, contractStatus: "confirmed" }).action?.href,
    ).toBe("/shows/show-1/terms");
  });
});

describe("termsGuidance", () => {
  it("sends a show without terms to the contract step", () => {
    const guidance = termsGuidance({ showId, status: null, latestVersion: null });
    expect(guidance.action?.href).toBe("/shows/show-1/contract");
  });

  it("names the version in place and points to the settlement", () => {
    const guidance = termsGuidance({ showId, status: "computed", latestVersion: 3 });
    expect(guidance.message).toContain("Terms v3");
    expect(guidance.action?.href).toBe("/shows/show-1/settlement");
  });
});

describe("settlementGuidance", () => {
  const base = {
    showId,
    status: "computed",
    ticketSaleCount: 2,
    hasTerms: true,
    pendingExpenseCount: 0,
    openFlagCount: 0,
    artistName: "Mara Quinn",
    artistHasAccount: true,
    failureReason: null,
  } as const;

  it("asks for the missing inputs before the first compute", () => {
    expect(settlementGuidance({ ...base, status: null, ticketSaleCount: 0 }).action?.href).toBe(
      "/shows/show-1/import",
    );
    expect(settlementGuidance({ ...base, status: "draft", hasTerms: false }).action?.href).toBe(
      "/shows/show-1/terms",
    );
  });

  it("points to the Compute button once the inputs are there", () => {
    const guidance = settlementGuidance({ ...base, status: null });
    expect(guidance.message).toContain("Compute");
    expect(guidance.action).toBeNull();
  });

  it("asks to decide pending expenses, then recompute", () => {
    const guidance = settlementGuidance({ ...base, pendingExpenseCount: 2 });
    expect(guidance.message).toBe("Decide the 2 pending expenses, then recompute.");
    expect(guidance.action?.href).toBe("/shows/show-1#expenses");
  });

  it("puts pending expenses before recomputing a stale settlement", () => {
    expect(settlementGuidance({ ...base, status: "stale", pendingExpenseCount: 1 }).message).toBe(
      "Decide the 1 pending expense, then recompute.",
    );
    expect(settlementGuidance({ ...base, status: "stale" }).message).toContain("Recompute");
  });

  it("asks to resolve open flags before submitting", () => {
    const guidance = settlementGuidance({ ...base, openFlagCount: 1 });
    expect(guidance.message).toContain("1 assistant flag,");
    expect(guidance.action?.href).toBe("#flags");
  });

  it("points to Submit for review when nothing blocks it", () => {
    const guidance = settlementGuidance(base);
    expect(guidance.message).toContain("submit it for review");
    expect(guidance.action).toBeNull();
  });

  it("in review: asks for a Stripe account first, then approval", () => {
    expect(
      settlementGuidance({ ...base, status: "in_review", artistHasAccount: false }).message,
    ).toContain("Connect a Stripe account for Mara Quinn");
    expect(settlementGuidance({ ...base, status: "in_review" }).message).toContain("approve");
  });

  it("says the settlement is final from approval on", () => {
    expect(settlementGuidance({ ...base, status: "approved" }).tone).toBe("locked");
    expect(settlementGuidance({ ...base, status: "paid" }).message).toContain("final");
  });

  it("gives the failure reason and points to Retry", () => {
    const guidance = settlementGuidance({
      ...base,
      status: "payment_failed",
      failureReason: "account_closed",
    });
    expect(guidance.tone).toBe("attention");
    expect(guidance.detail).toContain("account_closed");
    expect(guidance.action).toBeNull();
  });
});

describe("lockedInputsGuidance", () => {
  it("always links to the settlement", () => {
    for (const status of ["approved", "paying", "paid", "payment_failed"] as const) {
      expect(lockedInputsGuidance(showId, status).action?.href).toBe("/shows/show-1/settlement");
    }
  });
});

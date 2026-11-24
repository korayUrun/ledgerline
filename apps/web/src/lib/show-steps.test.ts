import { describe, expect, it } from "vitest";
import {
  contractStep,
  currentStepIndex,
  inputsLocked,
  salesStep,
  settlementStep,
  SHOW_STEPS,
  stepComplete,
  termsStep,
} from "./show-steps";

describe("inputsLocked", () => {
  it("locks from approval on, like the API", () => {
    expect(inputsLocked("approved")).toBe(true);
    expect(inputsLocked("paying")).toBe(true);
    expect(inputsLocked("paid")).toBe(true);
    expect(inputsLocked("payment_failed")).toBe(true);
  });

  it("leaves the inputs open before approval, and with no settlement", () => {
    expect(inputsLocked(null)).toBe(false);
    expect(inputsLocked("draft")).toBe(false);
    expect(inputsLocked("computed")).toBe(false);
    expect(inputsLocked("in_review")).toBe(false);
    expect(inputsLocked("stale")).toBe(false);
  });
});

describe("step states", () => {
  it("sales are done once there are ticket sales", () => {
    expect(salesStep(0, false).label).toBe("Not started");
    expect(salesStep(2, false).label).toBe("Done");
  });

  it("a contract waiting for review says so, even if older terms exist", () => {
    expect(contractStep("needs_review", true, false)).toEqual({
      tone: "attention",
      label: "Needs review",
    });
  });

  it("the contract step is done when confirmed, or when terms were typed in without one", () => {
    expect(contractStep("confirmed", true, false).label).toBe("Done");
    expect(contractStep(null, true, false).label).toBe("Done");
    expect(contractStep(null, false, false).label).toBe("Not started");
  });

  it("the input steps say Locked once the settlement is approved", () => {
    expect(salesStep(2, true).label).toBe("Locked");
    expect(contractStep("confirmed", true, true).label).toBe("Locked");
    expect(termsStep(true, true).label).toBe("Locked");
  });

  it("the settlement step reads the settlement status", () => {
    expect(settlementStep(null).label).toBe("Not started");
    expect(settlementStep("in_review").label).toBe("In review");
    expect(settlementStep("payment_failed")).toEqual({
      tone: "attention",
      label: "Payment failed",
    });
    expect(settlementStep("paid").tone).toBe("done");
  });
});

describe("the stepper", () => {
  const showId = "show-1";

  it("has the four steps in order", () => {
    expect(SHOW_STEPS.map((step) => step.title)).toEqual([
      "Sales & expenses",
      "Contract",
      "Deal terms",
      "Settlement",
    ]);
  });

  it("finds the step of each show page; the import belongs to step 1", () => {
    expect(currentStepIndex("/shows/show-1", showId)).toBe(0);
    expect(currentStepIndex("/shows/show-1/import", showId)).toBe(0);
    expect(currentStepIndex("/shows/show-1/contract", showId)).toBe(1);
    expect(currentStepIndex("/shows/show-1/terms", showId)).toBe(2);
    expect(currentStepIndex("/shows/show-1/settlement", showId)).toBe(3);
  });

  it("pages below a step belong to that step", () => {
    expect(currentStepIndex("/shows/show-1/contract/c-9", showId)).toBe(1);
    expect(currentStepIndex("/shows/show-1/settlement/runs/r-2", showId)).toBe(3);
  });

  it("does not match a longer path that only starts the same way", () => {
    expect(currentStepIndex("/shows/show-1/contracts-old", showId)).toBeNull();
    expect(currentStepIndex("/shows/show-12", showId)).toBeNull();
  });

  it("counts done and locked steps as complete on the track", () => {
    expect(stepComplete(salesStep(2, false))).toBe(true);
    expect(stepComplete(salesStep(2, true))).toBe(true);
    expect(stepComplete(salesStep(0, false))).toBe(false);
    expect(stepComplete(contractStep("needs_review", false, false))).toBe(false);
    expect(stepComplete(settlementStep("in_review"))).toBe(false);
  });
});

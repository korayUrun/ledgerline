import { describe, expect, it } from "vitest";
import { contractStep, inputsLocked, salesStep, settlementStep, termsStep } from "./show-steps";

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

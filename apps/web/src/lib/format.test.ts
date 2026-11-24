import { describe, expect, it } from "vitest";
import { formatShowDate } from "./format";

describe("formatShowDate", () => {
  it("formats a calendar date like the timestamps elsewhere", () => {
    expect(formatShowDate("2026-11-21")).toBe("Nov 21, 2026");
  });

  // Midnight UTC is still the previous evening in the Americas; formatting in the
  // machine's zone there would print Dec 31.
  it("keeps the same day whatever the machine's time zone", () => {
    expect(formatShowDate("2027-01-01")).toBe("Jan 1, 2027");
  });
});

import { describe, expect, it } from "vitest";
import { formatRelativeTime, formatShowDate } from "./format";

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

describe("formatRelativeTime", () => {
  const now = new Date("2026-11-24T12:00:00.000Z");

  it("counts minutes, hours and days back from now", () => {
    expect(formatRelativeTime("2026-11-24T11:59:30.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-11-24T11:55:00.000Z", now)).toBe("5 min ago");
    expect(formatRelativeTime("2026-11-24T09:00:00.000Z", now)).toBe("3 h ago");
    expect(formatRelativeTime("2026-11-23T10:00:00.000Z", now)).toBe("1 day ago");
    expect(formatRelativeTime("2026-11-20T12:00:00.000Z", now)).toBe("4 days ago");
  });

  it("gives the date once it is a week or more ago", () => {
    expect(formatRelativeTime("2026-11-10T12:00:00.000Z", now)).toBe("Nov 10, 2026");
  });
});

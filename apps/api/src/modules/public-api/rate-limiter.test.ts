import { describe, expect, it } from "vitest";
import { WINDOW_MS, windowAt } from "./rate-limiter.js";

describe("windowAt", () => {
  const minute = Date.UTC(2026, 10, 23, 12, 0, 0); // 12:00:00.000

  it("puts every moment of one minute in the same window", () => {
    expect(windowAt(minute).start).toBe(minute);
    expect(windowAt(minute + 30_000).start).toBe(minute);
    expect(windowAt(minute + WINDOW_MS - 1).start).toBe(minute);
    expect(windowAt(minute + WINDOW_MS).start).toBe(minute + WINDOW_MS);
  });

  it("says how many seconds are left until the next window, rounded up", () => {
    expect(windowAt(minute).retryAfterSeconds).toBe(60);
    expect(windowAt(minute + 59_500).retryAfterSeconds).toBe(1);
    expect(windowAt(minute + 20_001).retryAfterSeconds).toBe(40);
  });
});

import type { ApiKeyDto } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import {
  curlExample,
  formatRelativeTime,
  KEY_PLACEHOLDER,
  maskKey,
  mcpConfigExample,
  sortKeys,
} from "./api-keys";

describe("maskKey", () => {
  it("shows the prefix and hides the secret behind a fixed run of dots", () => {
    expect(maskKey("3f9a1c2e")).toBe("ll_3f9a1c2e_••••••••");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-11-24T12:00:00.000Z");
  const before = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("says just now under a minute, and for a time slightly in the future", () => {
    expect(formatRelativeTime(before(0), now)).toBe("just now");
    expect(formatRelativeTime(before(59_999), now)).toBe("just now");
    expect(formatRelativeTime(before(-5_000), now)).toBe("just now");
  });

  it("counts minutes and hours, rounded down, singular for one", () => {
    expect(formatRelativeTime(before(MIN), now)).toBe("1 minute ago");
    expect(formatRelativeTime(before(59 * MIN + 59_000), now)).toBe("59 minutes ago");
    expect(formatRelativeTime(before(HOUR), now)).toBe("1 hour ago");
    expect(formatRelativeTime(before(3 * HOUR + 40 * MIN), now)).toBe("3 hours ago");
  });

  it("says yesterday, then days, months and years", () => {
    expect(formatRelativeTime(before(DAY), now)).toBe("yesterday");
    expect(formatRelativeTime(before(2 * DAY), now)).toBe("2 days ago");
    expect(formatRelativeTime(before(29 * DAY), now)).toBe("29 days ago");
    expect(formatRelativeTime(before(30 * DAY), now)).toBe("1 month ago");
    expect(formatRelativeTime(before(364 * DAY), now)).toBe("12 months ago");
    expect(formatRelativeTime(before(365 * DAY), now)).toBe("1 year ago");
    expect(formatRelativeTime(before(800 * DAY), now)).toBe("2 years ago");
  });
});

describe("sortKeys", () => {
  function key(id: string, createdAt: string, revokedAt: string | null = null): ApiKeyDto {
    return {
      id,
      name: id,
      prefix: id,
      createdByName: "Demo Manager",
      createdAt,
      lastUsedAt: null,
      revokedAt,
    };
  }

  it("puts active keys first, each group newest first, without touching the input", () => {
    const keys = [
      key("old-active", "2026-11-01T10:00:00.000Z"),
      key("new-revoked", "2026-11-23T10:00:00.000Z", "2026-11-23T11:00:00.000Z"),
      key("new-active", "2026-11-20T10:00:00.000Z"),
      key("old-revoked", "2026-11-02T10:00:00.000Z", "2026-11-03T10:00:00.000Z"),
    ];
    expect(sortKeys(keys).map((k) => k.id)).toEqual([
      "new-active",
      "old-active",
      "new-revoked",
      "old-revoked",
    ]);
    expect(keys[0]?.id).toBe("old-active");
  });
});

describe("examples", () => {
  it("curl calls /v1/shows with a placeholder bearer token", () => {
    expect(curlExample("http://localhost:3002")).toBe(
      'curl -H "Authorization: Bearer <your key>" \\\n  http://localhost:3002/v1/shows',
    );
  });

  it("the MCP config uses the env names the server reads, and never a real key", () => {
    const config = JSON.parse(mcpConfigExample("http://localhost:3002")) as {
      mcpServers: { ledgerline: { env: Record<string, string>; args: string[] } };
    };
    expect(config.mcpServers.ledgerline.env).toEqual({
      LEDGERLINE_API_URL: "http://localhost:3002",
      LEDGERLINE_API_KEY: KEY_PLACEHOLDER,
    });
    expect(config.mcpServers.ledgerline.args.at(-1)).toMatch(/apps\/mcp\/src\/index\.ts$/);
  });
});

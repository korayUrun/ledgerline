import { setTimeout as sleep } from "node:timers/promises";
import type { CreatedApiKeyDto } from "@ledgerline/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimiter, WINDOW_MS } from "../src/modules/public-api/rate-limiter.js";
import {
  resetDatabase,
  startTestApp,
  TEST_RATE_LIMIT_PER_MINUTE,
  type TestApp,
} from "./test-app.js";

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
});

async function createKey(): Promise<string> {
  return (await t.request<CreatedApiKeyDto>("POST", "/api-keys", { name: "MCP" })).body.key;
}

function getShows(key: string): Promise<Response> {
  return t.fetch("/v1/shows", { headers: { authorization: `Bearer ${key}` } });
}

// The counter belongs to one clock minute. A burst that started at 12:00:59 would be
// split over two windows and the test would pass or fail by luck, so start in a
// fresh minute when the current one is nearly over.
async function awayFromWindowEdge(): Promise<void> {
  const msLeft = WINDOW_MS - (Date.now() % WINDOW_MS);
  if (msLeft < 5_000) {
    await sleep(msLeft + 50);
  }
}

describe("the /v1 rate limit (HTTP)", () => {
  it("answers 429 with Retry-After once a key used up its minute", async () => {
    const key = await createKey();
    await awayFromWindowEdge();

    for (let request = 1; request <= TEST_RATE_LIMIT_PER_MINUTE; request++) {
      const response = await getShows(key);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-ratelimit-remaining")).toBe(
        String(TEST_RATE_LIMIT_PER_MINUTE - request),
      );
    }
    const refused = await getShows(key);

    expect(refused.status).toBe(429);
    const retryAfter = Number(refused.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(((await refused.json()) as { message: string }).message).toMatch(/Rate limit reached/);
  });

  it("counts each key separately", async () => {
    const busy = await createKey();
    const quiet = await createKey();
    await awayFromWindowEdge();

    for (let request = 0; request <= TEST_RATE_LIMIT_PER_MINUTE; request++) {
      await getShows(busy);
    }

    expect((await getShows(busy)).status).toBe(429);
    expect((await getShows(quiet)).status).toBe(200);
  });

  it("does not limit the web app's session routes", async () => {
    for (let request = 0; request <= TEST_RATE_LIMIT_PER_MINUTE; request++) {
      expect((await t.request("GET", "/shows")).status).toBe(200);
    }
  });
});

describe("RateLimiter (against the test Redis, with a fixed clock)", () => {
  const minute = Date.UTC(2026, 10, 23, 12, 0, 0);

  it("allows the limit, refuses the next one, and starts over in the next minute", async () => {
    const limiter = new RateLimiter({ ...t.config, publicApi: { rateLimitPerMinute: 3 } });
    const keyId = `test-${Date.now()}`;
    try {
      expect(await limiter.consume(keyId, minute)).toEqual({ allowed: true, remaining: 2 });
      expect(await limiter.consume(keyId, minute + 10_000)).toEqual({
        allowed: true,
        remaining: 1,
      });
      expect(await limiter.consume(keyId, minute + 20_000)).toEqual({
        allowed: true,
        remaining: 0,
      });
      expect(await limiter.consume(keyId, minute + 40_000)).toEqual({
        allowed: false,
        retryAfterSeconds: 20,
      });
      expect(await limiter.consume(keyId, minute + WINDOW_MS)).toEqual({
        allowed: true,
        remaining: 2,
      });
    } finally {
      limiter.onApplicationShutdown();
    }
  });

  it("lets requests through when Redis cannot be reached (fail open)", async () => {
    // Port 1: nothing listens there, so every command fails at once.
    const limiter = new RateLimiter({
      ...t.config,
      redisUrl: "redis://127.0.0.1:1",
      publicApi: { rateLimitPerMinute: 1 },
    });
    try {
      expect((await limiter.consume("any", minute)).allowed).toBe(true);
      expect((await limiter.consume("any", minute)).allowed).toBe(true);
    } finally {
      limiter.onApplicationShutdown();
    }
  });
});

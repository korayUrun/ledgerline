import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { CONFIG } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";

// Rate limit for the /v1 API: at most N requests per API key per minute.
//
// Fixed window: the minute 12:00:00–12:00:59 has one counter in Redis, the next
// minute a new one. One INCR per request, and the counter deletes itself (EXPIRE).
// Rejected alternatives:
//   - @nestjs/throttler: one more dependency, and its default store is the process's
//     memory, so a restart (tsx watch) would reset every count.
//   - a sliding window (exact "last 60 seconds"): fairer at the minute boundary, but
//     needs a sorted set per key. A fixed window can let up to 2N through around a
//     boundary (N at 12:00:59, N at 12:01:00); for a limit that only keeps one client
//     from flooding the API, that is fine.
//
// Redis down = requests are allowed (fail open), with a warning in the log. The API
// key is the security boundary; the limit only protects capacity, and a read API
// that stops whenever Redis blinks would hurt more than a minute without a limit.

export const WINDOW_MS = 60_000;

export type Window = { start: number; retryAfterSeconds: number };

// The fixed window `now` falls in, and how long until the next one starts (rounded
// up: "retry after 0 seconds" would invite an immediate retry that fails again).
export function windowAt(now: number): Window {
  const start = now - (now % WINDOW_MS);
  return { start, retryAfterSeconds: Math.ceil((start + WINDOW_MS - now) / 1000) };
}

export type RateLimitDecision =
  { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

@Injectable()
export class RateLimiter implements OnApplicationShutdown {
  private readonly logger = new Logger(RateLimiter.name);
  private readonly redis: Redis;
  private readonly limit: number;

  constructor(@Inject(CONFIG) config: ApiConfig) {
    this.limit = config.publicApi.rateLimitPerMinute;
    this.redis = new Redis(config.redisUrl, {
      // A command sent before the connection is up waits for it (the offline queue,
      // on by default), so the first requests after startup are counted too. When
      // Redis is down, give up quickly instead of holding the request: one retry,
      // and at most 1 s to connect.
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
    });
    // Without a listener, ioredis reports every failed reconnect as an unhandled error.
    this.redis.on("error", (error: Error) => {
      this.logger.warn(`Redis: ${error.message}`);
    });
  }

  async consume(apiKeyId: string, now: number = Date.now()): Promise<RateLimitDecision> {
    const window = windowAt(now);
    const key = `ratelimit:v1:${apiKeyId}:${window.start}`;
    let count: number;
    try {
      // MULTI: both commands run together, so a counter never exists without its
      // expiry (which would keep it in Redis forever).
      const results = await this.redis.multi().incr(key).pexpire(key, WINDOW_MS).exec();
      const incremented = results?.[0];
      if (!incremented || incremented[0] !== null || typeof incremented[1] !== "number") {
        throw new Error("INCR did not return a number");
      }
      count = incremented[1];
    } catch (error) {
      this.logger.warn(`rate limit not checked (allowing the request): ${String(error)}`);
      return { allowed: true, remaining: this.limit };
    }

    if (count > this.limit) {
      return { allowed: false, retryAfterSeconds: window.retryAfterSeconds };
    }
    return { allowed: true, remaining: this.limit - count };
  }

  get limitPerMinute(): number {
    return this.limit;
  }

  // disconnect, not quit: quit waits for Redis to answer, which never happens when
  // Redis is the thing that is down.
  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}

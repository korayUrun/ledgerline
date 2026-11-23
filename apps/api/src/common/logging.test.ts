import { describe, expect, it } from "vitest";
import { readLogConfigFromEnv } from "../config.js";
import { addLogContext, createLogger, NestPinoLogger, withLogContext } from "./logging.js";

// A logger whose lines land in an array, parsed, instead of on stdout.
function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger(
    { level: "info", format: "json" },
    { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) },
  );
  return { logger, lines };
}

describe("log context", () => {
  it("adds the ids of the running context to every line", async () => {
    const { logger, lines } = capturingLogger();
    await withLogContext({ requestId: "req-1" }, async () => {
      await Promise.resolve(); // the context survives an await
      logger.info("inside");
    });
    logger.info("outside");

    expect(lines[0]).toMatchObject({ msg: "inside", requestId: "req-1" });
    expect(lines[1]).not.toHaveProperty("requestId");
  });

  it("merges a nested context without changing the outer one", () => {
    const { logger, lines } = capturingLogger();
    withLogContext({ requestId: "req-1" }, () => {
      withLogContext({ settlementId: "s-1" }, () => logger.info("nested"));
      logger.info("outer again");
    });

    expect(lines[0]).toMatchObject({ requestId: "req-1", settlementId: "s-1" });
    expect(lines[1]).toMatchObject({ requestId: "req-1" });
    expect(lines[1]).not.toHaveProperty("settlementId");
  });

  it("adds an id found halfway through to the rest of the context", async () => {
    const { logger, lines } = capturingLogger();
    await withLogContext({ jobId: "payouts:7" }, async () => {
      logger.info("before");
      await Promise.resolve();
      addLogContext({ settlementId: "s-1" });
      logger.info("after");
    });

    expect(lines[0]).not.toHaveProperty("settlementId");
    expect(lines[1]).toMatchObject({ jobId: "payouts:7", settlementId: "s-1" });
  });

  it("keeps two concurrent contexts apart", async () => {
    const { logger, lines } = capturingLogger();
    const slow = withLogContext({ requestId: "slow" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      logger.info("slow done");
    });
    const fast = withLogContext({ requestId: "fast" }, async () => {
      await Promise.resolve();
      logger.info("fast done");
    });
    await Promise.all([slow, fast]);

    expect(lines).toContainEqual(expect.objectContaining({ msg: "fast done", requestId: "fast" }));
    expect(lines).toContainEqual(expect.objectContaining({ msg: "slow done", requestId: "slow" }));
  });

  it("does nothing when addLogContext runs outside any context", () => {
    const { logger, lines } = capturingLogger();
    addLogContext({ settlementId: "s-1" });
    logger.info("no context");
    expect(lines[0]).not.toHaveProperty("settlementId");
  });
});

describe("NestPinoLogger", () => {
  it("turns Nest's trailing context argument into a field", () => {
    const { logger, lines } = capturingLogger();
    new NestPinoLogger(logger).log("job 1 attempt 1: paid", "PayoutWorker");
    expect(lines[0]).toMatchObject({
      level: 30,
      msg: "job 1 attempt 1: paid",
      context: "PayoutWorker",
    });
  });

  it("logs an Error as err with its stack", () => {
    const { logger, lines } = capturingLogger();
    new NestPinoLogger(logger).error("could not enqueue", new Error("redis down"), "Contracts");
    expect(lines[0]).toMatchObject({ level: 50, msg: "could not enqueue", context: "Contracts" });
    expect(lines[0]?.["err"]).toMatchObject({ message: "redis down" });
  });

  it("uses an Error passed as the message", () => {
    const { logger, lines } = capturingLogger();
    new NestPinoLogger(logger).error(new Error("boom"), "ApiExceptionFilter");
    expect(lines[0]).toMatchObject({ msg: "boom", context: "ApiExceptionFilter" });
  });
});

describe("readLogConfigFromEnv", () => {
  it("defaults to info, one JSON object per line", () => {
    expect(readLogConfigFromEnv({})).toEqual({ level: "info", format: "json" });
  });

  it("refuses an unknown level or format instead of guessing", () => {
    expect(() => readLogConfigFromEnv({ LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
    expect(() => readLogConfigFromEnv({ LOG_FORMAT: "text" })).toThrow(/LOG_FORMAT/);
  });
});

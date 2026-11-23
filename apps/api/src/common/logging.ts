import { AsyncLocalStorage } from "node:async_hooks";
import type { LoggerService } from "@nestjs/common";
import { pino, type DestinationStream, type Level, type Logger } from "pino";
import pretty from "pino-pretty";
import type { LogConfig } from "../config.js";

export type { Logger } from "pino";

// The ids that say what a log line belongs to (docs/SYSTEM.md §12). An HTTP request
// gets a requestId, a queue job a jobId; settlementId and contractId are added as
// soon as the code knows them. Grep one id and you get the whole story.
export type LogContext = {
  requestId?: string;
  jobId?: string;
  settlementId?: string;
  contractId?: string;
};

// AsyncLocalStorage keeps one LogContext per request or job, and Node carries it
// through every `await` started inside logContext.run(). That is how a log call deep
// in a service knows its requestId without the id being passed down as a parameter.
const logContext = new AsyncLocalStorage<LogContext>();

// Runs `work` with these ids added to the current ones. Ids set inside do not leak
// out: the outer context is untouched when `work` ends.
export function withLogContext<T>(fields: LogContext, work: () => T): T {
  return logContext.run({ ...logContext.getStore(), ...fields }, work);
}

// Adds ids to the context that is already running, for ids found halfway through
// (the payout job learns its settlementId only after reading the payout). Outside a
// request or job there is no context, and this does nothing.
export function addLogContext(fields: LogContext): void {
  const store = logContext.getStore();
  if (store) {
    Object.assign(store, fields);
  }
}

export function currentLogContext(): LogContext {
  return { ...logContext.getStore() };
}

// One JSON object per line by default. "pretty" prints the same fields as readable
// text for a terminal. The destination parameter is for tests, which capture lines.
export function createLogger(config: LogConfig, destination?: DestinationStream): Logger {
  const options = {
    level: config.level,
    // Called for every line: the current request's or job's ids become fields.
    mixin: () => currentLogContext(),
  };
  if (destination) {
    return pino(options, destination);
  }
  if (config.format === "pretty") {
    // In the main thread, not pino's worker-thread transport: simpler, and the
    // volume of a local app is tiny.
    return pino(options, pretty({ ignore: "pid,hostname", singleLine: true }));
  }
  return pino(options);
}

// Nest logs through a LoggerService (its own startup lines, and every
// `new Logger(SomeClass.name)` in our code). This adapter sends those calls to pino,
// so the existing log calls stay as they are and still get the ids above.
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write("info", message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    this.write("error", message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.write("warn", message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.write("debug", message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    this.write("trace", message, params);
  }
  fatal(message: unknown, ...params: unknown[]): void {
    this.write("fatal", message, params);
  }

  // Nest calls these as (message, ...extra, context): `new Logger("PayoutWorker")`
  // appends "PayoutWorker" as the last parameter. In between there may be an Error
  // or a stack string (logger.error("could not enqueue", error)).
  private write(level: Level, message: unknown, params: unknown[]): void {
    const fields: Record<string, unknown> = {};
    const last = params.at(-1);
    const extra = typeof last === "string" ? params.slice(0, -1) : params;
    if (typeof last === "string") {
      fields["context"] = last;
    }
    for (const param of extra) {
      if (param instanceof Error) {
        fields["err"] = param;
      } else if (typeof param === "string") {
        fields["stack"] = param;
      } else if (param !== undefined) {
        fields["detail"] = param;
      }
    }
    if (message instanceof Error) {
      this.logger[level]({ ...fields, err: message }, message.message);
    } else if (typeof message === "string") {
      this.logger[level](fields, message);
    } else {
      this.logger[level]({ ...fields, detail: message }, "(no message)");
    }
  }
}

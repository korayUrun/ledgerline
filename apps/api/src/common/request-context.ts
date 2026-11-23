import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type NestMiddleware,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { addLogContext, type Logger, withLogContext } from "./logging.js";
import { LOGGER } from "./tokens.js";

// A caller may send its own id (a proxy, or a client correlating its own logs). It
// lands in our logs and response headers, so only short, plain ids are accepted.
const CALLER_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

// Node's request plus the two fields Express adds that we read (the app runs on
// @nestjs/platform-express; same approach as AuthenticatedRequest in auth.guard.ts).
type ExpressRequest = IncomingMessage & {
  originalUrl: string;
  params?: Record<string, string | undefined>;
};

// Gives every request a requestId, runs the rest of the request inside a log
// context that carries it, and logs one line when the response is sent.
//
// Registered as Nest module middleware (AppModule.configure), not with app.use():
// module middleware runs after the body parser. The parser calls next() from a
// stream event, which would run the handler outside a context started before it.
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  use(request: ExpressRequest, response: ServerResponse, next: () => void): void {
    const header = request.headers["x-request-id"];
    const requestId =
      typeof header === "string" && CALLER_REQUEST_ID.test(header) ? header : randomUUID();
    response.setHeader("x-request-id", requestId);

    const startedAt = performance.now();
    withLogContext({ requestId }, () => {
      // An event listener runs in the context of whoever emits the event, not of
      // whoever registered it. bind() pins this one to the request's context, so
      // the line gets its requestId (and the settlementId added later).
      response.on(
        "finish",
        AsyncResource.bind(() => {
          // The path without the query string; never headers or bodies, which carry
          // session cookies, API keys and contract text.
          this.logger.info(
            {
              method: request.method,
              path: request.originalUrl.split("?")[0],
              statusCode: response.statusCode,
              durationMs: Math.round(performance.now() - startedAt),
            },
            "request finished",
          );
        }),
      );
      next();
    });
  }
}

// Route parameters are known only after routing, which happens after middleware, so
// the settlementId is added here. Every route about one settlement names its
// parameter :settlementId.
@Injectable()
export class SettlementLogContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ExpressRequest>();
    const settlementId = request.params?.["settlementId"];
    if (typeof settlementId === "string") {
      addLogContext({ settlementId });
    }
    return next.handle();
  }
}

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RateLimiter } from "./rate-limiter.js";

type HeaderResponse = { setHeader(name: string, value: string): unknown };

// Counts each /v1 request against its API key (UseGuards on V1Controller). Runs after
// the global AuthGuard, so the key is already known: a request without a valid key
// is refused before it can use up anyone's limit.
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(RateLimiter) private readonly limiter: RateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const { apiKey } = http.getRequest<AuthenticatedRequest>();
    if (!apiKey) {
      // Only possible on a route without @ApiKeyAuth(): a programming error.
      throw new Error("RateLimitGuard needs an API key route");
    }
    const response = http.getResponse<HeaderResponse>();
    const decision = await this.limiter.consume(apiKey.apiKeyId);
    response.setHeader("X-RateLimit-Limit", String(this.limiter.limitPerMinute));

    if (!decision.allowed) {
      // Retry-After (seconds) is the standard way to tell a client when to come back;
      // the MCP server passes it on, so the model can say "try again in 20 s".
      response.setHeader("Retry-After", String(decision.retryAfterSeconds));
      response.setHeader("X-RateLimit-Remaining", "0");
      throw new HttpException(
        `Rate limit reached: ${this.limiter.limitPerMinute} requests per minute per API key. Retry in ${decision.retryAfterSeconds} s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    response.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    return true;
  }
}

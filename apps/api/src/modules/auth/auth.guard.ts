import type { IncomingMessage } from "node:http";
import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { User } from "@ledgerline/db";
import { userActor, type Actor, type ApiKeyActor } from "../../common/actor.js";
import { ApiKeysService } from "../public-api/api-keys.service.js";
import { AuthService } from "./auth.service.js";

// The request after the guard has run. Only requests that passed have these set:
// actor + user for a session route, apiKey for an API key route. Never both.
export type AuthenticatedRequest = IncomingMessage & {
  actor?: Actor;
  user?: User;
  apiKey?: ApiKeyActor;
};

// Every route has exactly one way in:
//   - @Public()     nobody needs to log in (health check, login, Stripe webhook);
//   - @ApiKeyAuth() an API key, and only an API key (the /v1 routes, F9);
//   - neither       a logged-in person (everything else, approve and pay included).
// Closed by default: a new endpoint someone forgets to think about needs a person.
// And since a session route never looks at API keys, a key can never reach approve
// or pay, whatever route someone adds to /v1.
const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

const USES_API_KEY = "usesApiKey";
export const ApiKeyAuth = () => SetMetadata(USES_API_KEY, true);

// Registered for the whole app (APP_GUARD in AuthModule), so it runs before every
// controller method.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ApiKeysService) private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Both decorators can sit on the method or on the whole controller.
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);

    if (this.reflector.getAllAndOverride<boolean>(USES_API_KEY, targets)) {
      const apiKey = token === null ? null : await this.apiKeys.actorForKey(token);
      if (!apiKey) {
        // One message for missing, unknown and revoked: the caller learns nothing
        // about which keys exist.
        throw new UnauthorizedException(
          "A valid API key is required: Authorization: Bearer ll_… (it may have been revoked).",
        );
      }
      request.apiKey = apiKey;
      return true;
    }

    const user = token === null ? null : await this.auth.userForToken(token);
    if (!user) {
      throw new UnauthorizedException("Log in first.");
    }
    request.user = user;
    request.actor = userActor(user.id);
    return true;
  }
}

// "Authorization: Bearer <token>" → the token.
export function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim() || null;
}

// In a controller: `@CurrentActor() actor: Actor`, the person the guard found.
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const { actor } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!actor) {
    // Only possible on a @Public() or @ApiKeyAuth() route, which must not ask for a person.
    throw new UnauthorizedException("Log in first.");
  }
  return actor;
});

// In a /v1 controller: `@CurrentApiKey() apiKey: ApiKeyActor`, the key the guard found.
export const CurrentApiKey = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const { apiKey } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!apiKey) {
    // Only possible on a route without @ApiKeyAuth(): a programming error.
    throw new UnauthorizedException("A valid API key is required.");
  }
  return apiKey;
});

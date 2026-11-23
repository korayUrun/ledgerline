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
import { userActor, type Actor } from "../../common/actor.js";
import { AuthService } from "./auth.service.js";

// The request after the guard has run. Only requests that passed have these set.
export type AuthenticatedRequest = IncomingMessage & { actor?: Actor; user?: User };

// Every route needs a logged-in person unless it is marked @Public() (health
// check, login). Closed by default: a new endpoint someone forgets to think about
// is protected, not open.
const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

// Registered for the whole app (APP_GUARD in AuthModule), so it runs before every
// controller method.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public() can sit on the method or on the whole controller.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
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
    // Only possible on a @Public() route, which must not ask for an actor.
    throw new UnauthorizedException("Log in first.");
  }
  return actor;
});

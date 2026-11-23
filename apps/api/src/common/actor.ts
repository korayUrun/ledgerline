import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { DEMO_USER_EMAIL, type PrismaClient } from "@ledgerline/db";
import { PRISMA } from "./tokens.js";

// Who is making a change. Written into AuditLog.actor.
export type Actor = { userId: string; label: string }; // label: "user:<id>"

// Used for changes nobody asked for directly, e.g. marking a settlement stale after
// noticing that its inputs changed behind the API's back.
export const SYSTEM_ACTOR_LABEL = "system";

// Until login exists (planned for Phase 5, where approval needs a real person),
// every request acts as the seeded demo user. This class is the one place that
// will change when login arrives.
@Injectable()
export class ActorService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async current(): Promise<Actor> {
    const user = await this.prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    if (!user) {
      throw new InternalServerErrorException(
        `Demo user ${DEMO_USER_EMAIL} is missing: run pnpm db:seed`,
      );
    }
    return { userId: user.id, label: `user:${user.id}` };
  }
}

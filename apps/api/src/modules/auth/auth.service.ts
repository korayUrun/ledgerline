import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { hashPassword, verifyPassword, type PrismaClient, type User } from "@ledgerline/db";
import type { LoginResponseDto, UserDto } from "@ledgerline/schemas";
import { PRISMA } from "../../common/tokens.js";
import { hashSessionToken, newSessionToken } from "./session-token.js";

const SESSION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// A hash of a random password nobody knows. When the email has no account (or no
// password), login checks the guess against this instead of answering at once, so
// both cases cost one scrypt and take the same time. Made once, on first use.
let dummyHash: Promise<string> | undefined;
function hashForUnknownUser(): Promise<string> {
  dummyHash ??= hashPassword(newSessionToken());
  return dummyHash;
}

// Login with email and password (Phase 5): approval must be tied to a real person.
// One wrong-credentials message for every failure, and the same work for every
// failure, so neither the answer nor its timing tells an attacker whether an email
// has an account.
@Injectable()
export class AuthService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const storedHash = user?.passwordHash ?? (await hashForUnknownUser());
    // Runs in every case; only a real user with a real hash can pass.
    const passwordMatches = await verifyPassword(password, storedHash);
    const valid = user !== null && user.passwordHash !== null && passwordMatches;
    if (!user || !valid) {
      throw new UnauthorizedException("The email or password is wrong.");
    }

    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
    await this.prisma.session.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt },
    });
    return { token, expiresAt: expiresAt.toISOString(), user: toUserDto(user) };
  }

  // Deleting the row is what logs out: the token in the old cookie stops working
  // everywhere at once.
  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }

  // The user behind a token, or null when it is unknown or expired.
  async userForToken(token: string): Promise<User | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date()) {
      return null;
    }
    return session.user;
  }
}

export function toUserDto(user: User): UserDto {
  return { id: user.id, email: user.email, name: user.name };
}

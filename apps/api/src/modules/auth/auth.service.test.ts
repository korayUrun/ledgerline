import { UnauthorizedException } from "@nestjs/common";
import type { PrismaClient } from "@ledgerline/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service.js";

// Measuring response times in a test is flaky, so these tests check the cause
// instead: the slow scrypt check runs on every login, whether or not the email has
// an account. Then both answers take about the same time.
const verifyPassword = vi.fn<(password: string, stored: string) => Promise<boolean>>(() =>
  Promise.resolve(false),
);
vi.mock("@ledgerline/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ledgerline/db")>()),
  verifyPassword: (password: string, stored: string) => verifyPassword(password, stored),
}));

function serviceWithUser(user: { passwordHash: string | null } | null): AuthService {
  const prisma = { user: { findUnique: () => Promise.resolve(user) } } as unknown as PrismaClient;
  return new AuthService(prisma);
}

beforeEach(() => {
  verifyPassword.mockClear();
});

describe("login timing", () => {
  it("runs the password check for an unknown email too", async () => {
    await expect(serviceWithUser(null).login("nobody@example.test", "guess")).rejects.toThrow(
      UnauthorizedException,
    );

    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it("runs the password check for a user without a password", async () => {
    await expect(
      serviceWithUser({ passwordHash: null }).login("demo@example.test", "guess"),
    ).rejects.toThrow(UnauthorizedException);

    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });
});

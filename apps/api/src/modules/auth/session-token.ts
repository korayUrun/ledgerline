import { createHash, randomBytes } from "node:crypto";

// A session token is 32 random bytes: impossible to guess, so it needs no slow
// hashing like a password. Only its SHA-256 is stored, so someone who reads the
// Session table cannot use what they read to log in.

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

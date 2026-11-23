import { createHash, randomBytes } from "node:crypto";

// An API key looks like "ll_3f9a1c2e_Xk9…" (ll_ + prefix + _ + secret):
//   - "ll_" says what it is, so a key pasted into the wrong place (a log, a chat) is
//     easy to spot and to search for;
//   - the prefix (4 random bytes as 8 hex characters) is stored in clear and shown in
//     the key list, so a person can tell their keys apart;
//   - the secret (32 random bytes) is what makes the key impossible to guess.
//
// Only SHA-256(whole key) is stored. Like the session token, a key is random, not
// chosen by a person, so it needs no slow hash (scrypt) the way a password does:
// there is nothing to guess, and a fast hash is cheap to check on every request.

const KEY_PATTERN = /^ll_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;

export type NewApiKey = { key: string; prefix: string; keyHash: string };

export function newApiKey(): NewApiKey {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url"); // 43 characters, no padding
  const key = `ll_${prefix}_${secret}`;
  return { key, prefix, keyHash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// A cheap shape check before touching the database: a session token or random text
// sent to /v1 is refused without a query.
export function looksLikeApiKey(token: string): boolean {
  return KEY_PATTERN.test(token);
}

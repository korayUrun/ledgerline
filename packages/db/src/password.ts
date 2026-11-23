import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Password hashing with scrypt, which is built into Node (no extra package). scrypt
// is slow and memory-hungry on purpose: checking one guess is quick for us, but
// trying millions of guesses against a stolen hash is very expensive.
//
// Stored as "scrypt$<salt>$<hash>" (hex). The random salt makes two users with the
// same password get different hashes, so one cracked hash reveals nothing else.
//
// Lives in the db package because both the API (login) and the seed (demo user)
// need it, and neither the web app nor the engine may import it.

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keyLength: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  // Compares every byte however early they differ, so the response time does not
  // tell an attacker how much of the hash they got right.
  return timingSafeEqual(actual, expected);
}

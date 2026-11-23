import { describe, expect, it } from "vitest";
import { hashApiKey, looksLikeApiKey, newApiKey } from "./api-key-secret.js";

describe("newApiKey", () => {
  it("makes a key of the form ll_<prefix>_<secret> whose prefix is stored separately", () => {
    const { key, prefix } = newApiKey();

    expect(key).toMatch(/^ll_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    expect(key.startsWith(`ll_${prefix}_`)).toBe(true);
    expect(looksLikeApiKey(key)).toBe(true);
  });

  it("stores the SHA-256 of the whole key, which does not contain the key", () => {
    const { key, keyHash } = newApiKey();

    expect(keyHash).toBe(hashApiKey(key));
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHash).not.toContain(key.slice(12));
  });

  it("never makes the same key twice", () => {
    const keys = new Set(Array.from({ length: 100 }, () => newApiKey().key));

    expect(keys.size).toBe(100);
  });
});

describe("looksLikeApiKey", () => {
  it("refuses tokens that are not API keys", () => {
    expect(looksLikeApiKey("a-session-token")).toBe(false);
    expect(looksLikeApiKey("ll_3f9a1c2e_tooShort")).toBe(false);
    expect(looksLikeApiKey(`ll_NOTHEX00_${"a".repeat(43)}`)).toBe(false);
    expect(looksLikeApiKey(`ll_3f9a1c2e_${"a".repeat(43)}x`)).toBe(false);
  });
});

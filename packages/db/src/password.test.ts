import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("accepts the right password and refuses a wrong one", async () => {
    const stored = await hashPassword("correct horse");

    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("correct hors", stored)).toBe(false);
  });

  it("never stores the password, and salts every hash", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");

    expect(first).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(first).not.toContain("same password");
    expect(first).not.toBe(second);
  });

  it("refuses a stored value it does not understand", async () => {
    expect(await verifyPassword("anything", "plain-text")).toBe(false);
  });
});

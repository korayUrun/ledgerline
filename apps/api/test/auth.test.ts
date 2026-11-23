import { DEMO_USER_EMAIL, DEMO_USER_PASSWORD } from "@ledgerline/db";
import type { LoginResponseDto, ShowDto, UserDto } from "@ledgerline/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashSessionToken } from "../src/modules/auth/session-token.js";
import { resetDatabase, startTestApp, type TestApp } from "./test-app.js";

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
});

const NO_AUTH = {};
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function login(email: string, password: string) {
  return t.request<LoginResponseDto & { message: string }>(
    "POST",
    "/auth/login",
    { email, password },
    NO_AUTH,
  );
}

describe("login", () => {
  it("returns a token that identifies the person on later requests", async () => {
    const response = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email: DEMO_USER_EMAIL, name: "Demo Manager" });
    const me = await t.request<UserDto>("GET", "/auth/me", undefined, bearer(response.body.token));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(DEMO_USER_EMAIL);
  });

  it("accepts the email in any case and with spaces around it", async () => {
    const response = await login(`  ${DEMO_USER_EMAIL.toUpperCase()} `, DEMO_USER_PASSWORD);

    expect(response.status).toBe(200);
  });

  it("stores only the token's hash, never the token", async () => {
    const { body } = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);

    const sessions = await t.prisma.session.findMany();
    expect(sessions.map((session) => session.tokenHash)).toContain(hashSessionToken(body.token));
    expect(JSON.stringify(sessions)).not.toContain(body.token);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrongPassword = await login(DEMO_USER_EMAIL, "not-the-password");
    const unknownEmail = await login("nobody@ledgerline.test", "not-the-password");

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Telling them apart would reveal which emails have an account.
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });
});

describe("protected routes", () => {
  it("refuse a request without a token, or with an unknown one", async () => {
    const none = await t.request("GET", "/shows", undefined, NO_AUTH);
    const unknown = await t.request("GET", "/shows", undefined, bearer("made-up"));

    expect(none.status).toBe(401);
    expect(unknown.status).toBe(401);
  });

  it("refuse an expired session", async () => {
    await t.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1_000) } });

    const response = await t.request("GET", "/shows");

    expect(response.status).toBe(401);
  });

  it("record the logged-in person as the actor of a change", async () => {
    const venue = await t.request<{ id: string }>("POST", "/venues", { name: "Hall" });
    const artist = await t.request<{ id: string }>("POST", "/artists", { name: "Band" });
    const show = await t.request<ShowDto>("POST", "/shows", {
      name: "Night",
      showDate: "2026-11-06",
      venueId: venue.body.id,
      artistId: artist.body.id,
    });
    await t.request("POST", `/shows/${show.body.id}/expenses`, {
      category: "production",
      description: "Crew",
      amountCents: 1_000,
      status: "pending",
    });

    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: DEMO_USER_EMAIL } });
    const entry = await t.prisma.auditLog.findFirstOrThrow({ where: { entity: "expense" } });
    expect(entry.actor).toBe(`user:${user.id}`);
  });

  it("leave the health check open for monitoring", async () => {
    const response = await t.request("GET", "/health", undefined, NO_AUTH);

    expect(response.status).toBe(200);
  });
});

describe("logout", () => {
  it("ends the session everywhere: the old token stops working", async () => {
    const { body } = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);

    const out = await t.request("POST", "/auth/logout", undefined, bearer(body.token));
    const after = await t.request("GET", "/auth/me", undefined, bearer(body.token));

    expect(out.status).toBe(204);
    expect(after.status).toBe(401);
  });
});

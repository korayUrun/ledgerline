import { cookies } from "next/headers";

// The API session token lives in an httpOnly cookie: the browser sends it to this
// web server with every request, but page JavaScript cannot read it, so a script
// injected into a page cannot steal it. The web server adds it to its API calls as
// "Authorization: Bearer <token>".

export const SESSION_COOKIE = "ledgerline_session";

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await sessionToken();
  return token === null ? {} : { authorization: `Bearer ${token}` };
}

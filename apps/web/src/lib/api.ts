import type { ApiErrorDto, LoginBody, LoginResponseDto, UserDto } from "@ledgerline/schemas";
import { redirect } from "next/navigation";
import { authHeaders } from "./session";

// The web app never touches the database: every read and write goes to the API
// over HTTP (docs/SYSTEM.md §2). These helpers run on the Next.js server only
// (server components, server actions, route handlers), so the browser never calls
// the API. Each call carries the person's session token (lib/session.ts).

const API_URL = process.env["API_URL"] ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorDto,
  ) {
    super(body.message);
  }
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(await authHeaders()),
      // FormData sets its own multipart content-type (with the boundary).
      ...(body === undefined || isForm ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? null : isForm ? body : JSON.stringify(body),
    cache: "no-store", // money data: always fresh
  });
  // Not logged in, or the session expired: go to the login page. redirect() works
  // by throwing, so this also ends the page render or server action.
  if (response.status === 401) {
    redirect("/login");
  }
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, parsed as ApiErrorDto);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => send<T>("GET", path),
  post: <T>(path: string, body?: unknown) => send<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => send<T>("PATCH", path, body),
  delete: (path: string) => send<null>("DELETE", path),
};

// Login is the one call where a 401 is an answer to show ("wrong password"), not
// a reason to go to the login page.
export async function loginRequest(body: LoginBody): Promise<LoginResponseDto> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const parsed: unknown = await response.json();
  if (!response.ok) {
    throw new ApiError(response.status, parsed as ApiErrorDto);
  }
  return parsed as LoginResponseDto;
}

// Who is logged in, or null. For the top bar, which is also on the login page and
// so must not redirect there.
export async function currentUser(): Promise<UserDto | null> {
  const headers = await authHeaders();
  if (!headers["authorization"]) return null;
  const response = await fetch(`${API_URL}/auth/me`, { headers, cache: "no-store" });
  return response.ok ? ((await response.json()) as UserDto) : null;
}

// For the file routes (receipts, contract PDFs): the API response as it is, so it
// can be streamed to the browser.
export async function fetchFromApi(path: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, { headers: await authHeaders(), cache: "no-store" });
}

// For the assistant's route handlers: forwards a POST to the API and passes the
// response through unchanged, so the event stream reaches the browser as it is
// produced (and a JSON error keeps its status). The browser only ever talks to
// the web server.
export async function proxyPost(path: string, body?: string): Promise<Response> {
  const upstream = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      ...(await authHeaders()),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body ?? null,
    cache: "no-store",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-cache, no-transform",
    },
  });
}

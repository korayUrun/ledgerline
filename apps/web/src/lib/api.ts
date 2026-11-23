import type { ApiErrorDto } from "@ledgerline/schemas";

// The web app never touches the database: every read and write goes to the API
// over HTTP (docs/SYSTEM.md §2). These helpers run on the Next.js server only
// (server components and server actions), so the browser never calls the API.

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
    // FormData sets its own multipart content-type (with the boundary).
    headers: body === undefined || isForm ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : isForm ? body : JSON.stringify(body),
    cache: "no-store", // money data: always fresh
  });
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

// For the receipt download route, which streams the response as it is.
export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

// For the assistant's route handlers: forwards a POST to the API and passes the
// response through unchanged, so the event stream reaches the browser as it is
// produced (and a JSON error keeps its status). The browser only ever talks to
// the web server.
export async function proxyPost(path: string, body?: string): Promise<Response> {
  const upstream = await fetch(apiUrl(path), {
    method: "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
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

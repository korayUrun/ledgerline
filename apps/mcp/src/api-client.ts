import { V1ErrorSchema } from "@ledgerline/schemas";
import type { z } from "zod";
import type { McpConfig } from "./config.js";

// The only way this server reaches Ledgerline: HTTP to the /v1 API with an API key.
// No database, no business rules here (docs/SYSTEM.md §10), so the API's auth,
// validation, rate limit and audit log apply to every tool call.

const TIMEOUT_MS = 10_000;

// A failed call, worded for the model: tool errors are shown to it, so each message
// says what happened and what a person can do about it.
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null, // null = no HTTP answer at all
  ) {
    super(message);
  }
}

// Passed in, so tests can answer without a network.
export type Fetch = typeof fetch;

export class LedgerlineApi {
  constructor(
    private readonly config: McpConfig,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.request("GET", path, schema);
  }

  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.request("POST", path, schema, body);
  }

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.apiUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // Connection refused, DNS, or the timeout above.
      throw new ApiRequestError(
        `Could not reach the Ledgerline API at ${this.config.apiUrl} (not running, or no answer within ${TIMEOUT_MS / 1000} s).`,
        null,
      );
    }

    const json = parseJson(await response.text());
    if (!response.ok) {
      throw new ApiRequestError(describeError(response, json), response.status);
    }
    // Our own API, but still checked: a wrong URL can point at another server that
    // also answers 200, and the model must not read its data as Ledgerline's.
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiRequestError(
        `The server at ${this.config.apiUrl} answered, but not in the shape of the Ledgerline API. Check LEDGERLINE_API_URL.`,
        response.status,
      );
    }
    return parsed.data;
  }
}

// undefined for an empty or non-JSON body (e.g. an HTML error page).
function parseJson(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function describeError(response: Response, body: unknown): string {
  const apiError = V1ErrorSchema.safeParse(body);
  const apiMessage = apiError.success ? apiError.data.message : response.statusText;
  switch (response.status) {
    case 401:
      return "The Ledgerline API refused the API key (missing, unknown or revoked). A person must create a new key on the web app's API keys page and update the MCP config.";
    case 429:
      return `Rate limit reached. Try again in ${response.headers.get("retry-after") ?? "a few"} seconds.`;
    default:
      return `The Ledgerline API answered ${response.status}: ${apiMessage}`;
  }
}

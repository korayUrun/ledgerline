import { V1ShowListSchema } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { ApiRequestError, LedgerlineApi, type Fetch } from "./api-client.js";

const CONFIG = { apiUrl: "http://api.test", apiKey: `ll_3f9a1c2e_${"a".repeat(43)}` };
const SHOWS = { data: [] };

type Sent = { url: string; init: RequestInit | undefined };

// A fake fetch that always gives the same answer and remembers what was sent.
function fakeFetch(answer: () => Response): { fetchFn: Fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchFn: Fetch = (input, init) => {
    // fetch also accepts a Request, whose String() is "[object Request]".
    const url = input instanceof Request ? input.url : String(input);
    sent.push({ url, init });
    return Promise.resolve(answer());
  };
  return { fetchFn, sent };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

// The error a call failed with (the test fails if it did not fail).
async function failure(call: Promise<unknown>): Promise<ApiRequestError> {
  const error = await call.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

describe("LedgerlineApi", () => {
  it("sends the API key and returns the parsed answer", async () => {
    const { fetchFn, sent } = fakeFetch(() => json(200, SHOWS));
    const api = new LedgerlineApi(CONFIG, fetchFn);

    const shows = await api.get("/v1/shows", V1ShowListSchema);

    expect(shows).toEqual(SHOWS);
    expect(sent[0]?.url).toBe("http://api.test/v1/shows");
    expect(sent[0]?.init?.method).toBe("GET");
    expect(sent[0]?.init?.headers).toEqual({ authorization: `Bearer ${CONFIG.apiKey}` });
  });

  it("sends a POST body as JSON", async () => {
    const { fetchFn, sent } = fakeFetch(() => json(201, SHOWS));
    const api = new LedgerlineApi(CONFIG, fetchFn);

    await api.post("/v1/anything", { kind: "other" }, V1ShowListSchema);

    expect(sent[0]?.init?.body).toBe('{"kind":"other"}');
    expect(sent[0]?.init?.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("says what to do when the key is refused (revoked)", async () => {
    const { fetchFn } = fakeFetch(() => json(401, { statusCode: 401, message: "nope" }));

    const error = await failure(
      new LedgerlineApi(CONFIG, fetchFn).get("/v1/shows", V1ShowListSchema),
    );

    expect(error.status).toBe(401);
    expect(error.message).toMatch(/revoked/);
    expect(error.message).toMatch(/create a new key/);
  });

  it("passes on how long to wait after the rate limit", async () => {
    const { fetchFn } = fakeFetch(() =>
      json(429, { statusCode: 429, message: "Rate limit reached" }, { "retry-after": "17" }),
    );

    const error = await failure(
      new LedgerlineApi(CONFIG, fetchFn).get("/v1/shows", V1ShowListSchema),
    );

    expect(error.message).toBe("Rate limit reached. Try again in 17 seconds.");
  });

  it("passes on the API's own message for other errors", async () => {
    const { fetchFn } = fakeFetch(() =>
      json(404, { statusCode: 404, message: "There is no line at position 99." }),
    );

    const error = await failure(new LedgerlineApi(CONFIG, fetchFn).get("/v1/x", V1ShowListSchema));

    expect(error.message).toBe("The Ledgerline API answered 404: There is no line at position 99.");
  });

  it("refuses an answer that is not in the API's shape (another server on that port)", async () => {
    const { fetchFn } = fakeFetch(
      () => new Response("<html>Some other app</html>", { status: 200 }),
    );

    const error = await failure(
      new LedgerlineApi(CONFIG, fetchFn).get("/v1/shows", V1ShowListSchema),
    );

    expect(error.message).toMatch(/not in the shape of the Ledgerline API/);
  });

  it("says the API cannot be reached when the connection fails", async () => {
    const fetchFn: Fetch = () => Promise.reject(new TypeError("fetch failed"));

    const error = await failure(
      new LedgerlineApi(CONFIG, fetchFn).get("/v1/shows", V1ShowListSchema),
    );

    expect(error.status).toBeNull();
    expect(error.message).toMatch(/Could not reach the Ledgerline API at http:\/\/api\.test/);
  });
});

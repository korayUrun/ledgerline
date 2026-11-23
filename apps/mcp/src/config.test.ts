import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

const KEY = `ll_3f9a1c2e_${"a".repeat(43)}`;

describe("readConfig", () => {
  it("reads the URL and the key, without a trailing slash", () => {
    const config = readConfig({
      LEDGERLINE_API_URL: "http://localhost:3002/",
      LEDGERLINE_API_KEY: KEY,
    });

    expect(config).toEqual({ apiUrl: "http://localhost:3002", apiKey: KEY });
  });

  it("uses the API's default port when no URL is given", () => {
    expect(readConfig({ LEDGERLINE_API_KEY: KEY }).apiUrl).toBe("http://localhost:3001");
  });

  it("refuses to start without a key", () => {
    expect(() => readConfig({})).toThrow(/LEDGERLINE_API_KEY is not set/);
  });

  it("refuses something that is not an API key, without repeating it", () => {
    expect(() => readConfig({ LEDGERLINE_API_KEY: "a-session-token" })).toThrow(
      /does not look like/,
    );
    expect(() => readConfig({ LEDGERLINE_API_KEY: "a-session-token" })).not.toThrow(
      /a-session-token/,
    );
  });

  it("refuses a URL it cannot parse", () => {
    expect(() =>
      readConfig({ LEDGERLINE_API_URL: "localhost 3002", LEDGERLINE_API_KEY: KEY }),
    ).toThrow(/not a valid URL/);
  });
});

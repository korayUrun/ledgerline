import type { ApiKeyDto } from "@ledgerline/schemas";

// Display helpers for the API keys page. Pure (the current time is passed in), so the
// tests need no clock and no browser.

// The key list never has the secret (the API stores only a hash). What it has is the
// prefix, the part of "ll_<prefix>_<secret>" a person can tell keys apart by; the dots
// stand in for the secret, at a fixed length so they never hint at its real one.
export function maskKey(prefix: string): string {
  return `ll_${prefix}_••••••••`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

// "3 hours ago", for "Last used". Rounded down, like most developer dashboards: 59
// minutes is still "59 minutes ago", not "1 hour ago". A time in the future (the API's
// clock a little ahead of the web server's) reads as "just now" rather than "in 2
// seconds". The page puts the exact time next to it in a tooltip.
export function formatRelativeTime(iso: string, now: Date): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return ago(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return ago(Math.floor(elapsed / HOUR), "hour");
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "yesterday";
  if (days < 30) return ago(days, "day");
  if (days < 365) return ago(Math.floor(days / 30), "month");
  return ago(Math.floor(days / 365), "year");
}

// Active keys first (they are the ones you manage), then newest first. A new array;
// the API's list is left as it is.
export function sortKeys(keys: readonly ApiKeyDto[]): ApiKeyDto[] {
  return [...keys].sort((a, b) => {
    const revoked = Number(a.revokedAt !== null) - Number(b.revokedAt !== null);
    if (revoked !== 0) return revoked;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// The examples under "Use your key". "<your key>" is a placeholder on purpose: the
// real key exists only in the one-time callout after creation.
export const KEY_PLACEHOLDER = "<your key>";

export function curlExample(apiUrl: string): string {
  return `curl -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\\n  ${apiUrl}/v1/shows`;
}

// Claude Desktop's claude_desktop_config.json entry, as in the README ("Connect the MCP
// server"). The variable names are the ones apps/mcp/src/config.ts reads. The paths
// stay placeholders: the README explains how to find them on your machine (Claude
// Desktop starts the server without your shell's PATH, so they must be absolute).
export function mcpConfigExample(apiUrl: string): string {
  const config = {
    mcpServers: {
      ledgerline: {
        command: "/absolute/path/to/node",
        args: [
          "/absolute/path/to/ledgerline/apps/mcp/node_modules/tsx/dist/cli.mjs",
          "/absolute/path/to/ledgerline/apps/mcp/src/index.ts",
        ],
        env: {
          LEDGERLINE_API_URL: apiUrl,
          LEDGERLINE_API_KEY: KEY_PLACEHOLDER,
        },
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

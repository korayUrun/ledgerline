// Read once at startup. The MCP client (Claude Desktop, Claude Code) starts this
// process and passes these values in the "env" block of its MCP config. The repo's
// .env is not read here: it belongs to the API and the worker.
export type McpConfig = {
  apiUrl: string; // e.g. "http://localhost:3001", without a trailing slash
  apiKey: string; // "ll_<prefix>_<secret>", created on the web app's API keys page
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const apiKey = env["LEDGERLINE_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "LEDGERLINE_API_KEY is not set. Create a key on the web app's API keys page and put it in the MCP client's config.",
    );
  }
  // Never echo the value in the message: error text can end up in logs.
  if (!apiKey.startsWith("ll_")) {
    throw new Error("LEDGERLINE_API_KEY does not look like a Ledgerline API key (ll_…).");
  }

  const apiUrl = (env["LEDGERLINE_API_URL"] ?? "http://localhost:3001").replace(/\/+$/, "");
  if (!URL.canParse(apiUrl)) {
    throw new Error(`LEDGERLINE_API_URL is not a valid URL: "${apiUrl}"`);
  }
  return { apiUrl, apiKey };
}

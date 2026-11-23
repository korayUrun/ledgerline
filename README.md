# Ledgerline

Ledgerline turns an artist contract (PDF), ticket sales and show expenses into a correct,
explainable artist payout, then pays it through Stripe (test mode). The AI reads and
explains, the code calculates, a person approves. Synthetic data only.

Docs: [project overview](docs/PROJECT_OVERVIEW.md) · [features](docs/FEATURES.md) ·
[architecture](docs/SYSTEM.md) · [build phases](docs/PHASES.md)

> This README is filled in during Phase 7 (problem, architecture diagram, eval results,
> how to run). For now it covers connecting the MCP server.

## Connect the MCP server (Claude Desktop, Claude Code)

`apps/mcp` is an MCP server with four tools, each a thin wrapper over one route of the
public `/v1` API. It reads settlements and explains them; it cannot approve or pay.

| Tool | API route | What it is for |
|---|---|---|
| `list_shows` | `GET /v1/shows` | find a show and its settlement id |
| `get_settlement` | `GET /v1/settlements/:id` | the worksheet lines down to the payout |
| `explain_settlement_line` | `GET /v1/settlements/:id/lines/:position` | the ticket tiers, expenses and contract clause behind one line |
| `flag_expense` | `POST /v1/expenses/:id/flags` | a note on an expense for a person to review |

### 1. Run the API and create a key

```bash
docker compose up -d
pnpm dev                      # web on :3000, API on :3001 (API_PORT to change it)
```

Log in to the web app, open **API keys**, create a key and copy it. It is shown once.

### 2. Find the two absolute paths

MCP clients start the server themselves, without your shell's `PATH` (nvm included), so
use absolute paths:

```bash
which node                                              # e.g. /Users/you/.nvm/versions/node/v24.12.0/bin/node
echo "$PWD/apps/mcp/node_modules/tsx/dist/cli.mjs"      # run from the repo root
echo "$PWD/apps/mcp/src/index.ts"
```

### 3a. Claude Desktop

Settings → Developer → Edit Config (`claude_desktop_config.json`), then restart Claude
Desktop:

```json
{
  "mcpServers": {
    "ledgerline": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/ledgerline/apps/mcp/node_modules/tsx/dist/cli.mjs",
        "/absolute/path/to/ledgerline/apps/mcp/src/index.ts"
      ],
      "env": {
        "LEDGERLINE_API_URL": "http://localhost:3001",
        "LEDGERLINE_API_KEY": "ll_…"
      }
    }
  }
}
```

### 3b. Claude Code

```bash
claude mcp add ledgerline \
  -e LEDGERLINE_API_URL=http://localhost:3001 \
  -e LEDGERLINE_API_KEY=ll_… \
  -- /absolute/path/to/node \
     /absolute/path/to/ledgerline/apps/mcp/node_modules/tsx/dist/cli.mjs \
     /absolute/path/to/ledgerline/apps/mcp/src/index.ts
```

Then ask, for example: *"Why did we pay The Velvet Harbors $12,223.65? Go line by line
and cite the contract."*

### Try it without a chat client: MCP Inspector

```bash
npx @modelcontextprotocol/inspector@2.14.0 \
  -e LEDGERLINE_API_URL=http://localhost:3001 -e LEDGERLINE_API_KEY=ll_… \
  "$(which node)" apps/mcp/node_modules/tsx/dist/cli.mjs apps/mcp/src/index.ts
```

This opens a browser UI where you can list the tools and call them. Add `--cli --method
tools/list` (or `--method tools/call --tool-name list_shows`) to stay in the terminal.

### When something is wrong

The server writes its log to stderr (Claude Desktop: Settings → Developer → the server's
log). Tool errors are worded for the model, so the chat usually says what happened:

- *"refused the API key (missing, unknown or revoked)"*: create a new key and update the config.
- *"Could not reach the Ledgerline API"*: the API is not running, or the URL or port is wrong.
- *"answered, but not in the shape of the Ledgerline API"*: `LEDGERLINE_API_URL` points at
  another server.
- *"Rate limit reached"*: wait the number of seconds given (`V1_RATE_LIMIT_PER_MINUTE`).

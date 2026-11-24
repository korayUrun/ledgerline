# Ledgerline — Build Phases

Eight phases, each ending in something that runs. Feature IDs (F1–F12) refer to `FEATURES.md`; design details are in `SYSTEM.md`.

Every phase has four parts:
- **Tasks:** what gets built.
- **Done when:** objective exit criteria. Don't move on until they're true.
- **Explain it:** questions I must be able to answer out loud, without notes. If I can't, the phase isn't done.
- **Break it:** a deliberate failure to cause, observe and diagnose.

Estimated total: ~4 weeks part-time.

---

## Phase 0 — Domain & foundations (2–3 days)

**Goal:** understand settlements well enough to calculate one by hand, and have an empty but working monorepo.

**Tasks**
- [x] Write `docs/domain.md`: deal types (flat, percentage, versus, guarantee plus), GBOR vs NBOR, expense caps, split point, promoter profit, bonus tiers. Work through one hand-calculated example of each type.
- [x] pnpm workspaces + Turborepo; `apps/web`, `apps/api`, `apps/mcp`, `packages/{settlement-engine,schemas,db,evals}` as empty shells
- [x] TypeScript strict mode, ESLint (including import-boundary rules from SYSTEM.md §2), Prettier, Vitest
- [x] `docker-compose.yml` with Postgres + Redis; `.env.example`
- [x] GitHub Actions `ci.yml`: install → lint → typecheck → test
- [x] Add `CLAUDE.md`, `PROJECT_OVERVIEW.md`, `FEATURES.md`, `SYSTEM.md`, `PHASES.md`, an empty `DEBUGGING.md` (removed in Phase 7, see below)

**Done when:** `docker compose up` starts the DB and Redis; `pnpm test` passes in CI; the hand-calculated examples in `domain.md` are written down.

**Explain it**
- What's the difference between a versus deal and a guarantee-plus deal? When does the artist earn more under each?
- Why does the monorepo forbid `settlement-engine` from importing `db`?

**Break it:** add an `import` from `db` into `settlement-engine` and make sure lint fails.

**Status:** done 2026-11-18 (PRs #1–#6, CI green on `main`). Design decisions in `domain.md` §3, §8, §9 kept as written. The Break it drill is deferred to the end of the project.

---

## Phase 1 — Settlement engine (F4) (4–5 days)

**Goal:** the money math is correct and proven before anything else exists.

**Tasks**
- [x] Zod schemas in `packages/schemas`: `ContractTerms`, `TicketSale`, `Expense`, `SettlementInput`, `SettlementResult`, `SettlementLine`
- [x] Money helpers: integer cents, basis points, `roundHalfUp`, `applyBps`
- [x] Pipeline: GBOR → NBOR → allowed expenses (category caps + total cap) → deal formula → bonuses → lines
- [x] All four deal types + bonus tiers; every line carries `clauseRef` and `sourceRefs`
- [x] Unit tests: the hand-calculated examples from `domain.md`
- [x] Property tests (fast-check): payout ≥ 0; versus payout ≥ guarantee; lines reconcile to total; payout monotonic in tickets sold
- [x] Golden files: `fixtures/*.input.json` → `*.expected.json`

**Done when:** 100% branch coverage on the engine; all property tests pass with 1,000+ runs; the engine has zero runtime dependencies besides `schemas`.

**Explain it**
- Why integer cents and not `number` with decimals? Show a float bug in the REPL.
- Where exactly does rounding happen, and why there?
- What does a property test find that an example test doesn't?

**Break it:** switch one calculation to floats or move a rounding step. Which tests fail, and why?

**Status:** done 2026-11-18 (PRs #8, #10–#12, CI green on `main`). 100% branch coverage, property tests at 1,000 runs, golden files in place. Handed to Phase 2: turning the engine's `ZodError` into an HTTP error, and deciding how `pending` expenses are handled at compute time. The Break it drill is deferred to the end of the project.

---

## Phase 2 — Data model, core API & basic UI (F1, F5, F12 audit) (4–5 days)

**Goal:** create a show, import data, enter terms by hand, compute and view a settlement. No AI yet.

**Tasks**
- [x] Prisma schema (SYSTEM.md §4) + migrations + seed script with 3 demo shows
- [x] NestJS modules: `shows`, `settlements`, `audit`; CSV import for ticket sales; expense CRUD with receipt upload (local disk)
- [x] `SettlementStateMachine` service: `draft → computed → in_review` (later states come in Phase 5); every transition writes `AuditLog` in the same transaction
- [x] Compute endpoint: builds `inputSnapshot`, `inputsHash`, calls the engine, stores the result + lines
- [x] Stale detection: an input change after compute → `stale`
- [x] Next.js: show list, show detail, import screen, manual terms form, settlement worksheet with line provenance
- [x] Integration tests with Testcontainers Postgres

**Done when:** for a seeded show I can enter terms → compute → see a worksheet where every line points to its source; editing an expense marks the settlement stale.

**Explain it**
- Why store `inputSnapshot` when the data is already in other tables?
- What happens if two requests compute the same settlement at the same moment?
- Why must the audit log write be in the same transaction as the status change?

**Break it:** change an expense amount directly in the DB after compute. Does the system notice? How?

**Status:** done 2026-11-19 (PRs #14–#18, CI green on `main`). The Explain it quiz and the Break it drill are deferred to the end of the project; questions and answers are in `SELF_CHECK.md` (the Break it scenario is also an automated integration test).

---

## Phase 3 — Eval data + contract extraction + review (F11, F2, F3, F8) (5–6 days)

**Goal:** upload a PDF and get correct terms, and *measure* how correct they are from day one.

**Tasks**
- [x] `packages/evals` generator: random `ContractTerms` → PDF via templates (varied wording, clause order, distractor clauses) + matching sales/expenses → expected payout via the engine
- [x] Generate 25 contracts; commit the dataset
- [x] `modules/llm`: Claude client wrapper (model from config, timeout, retry on 429/5xx, token + cost logging)
- [x] Extraction: PDF → Claude with the `ContractTerms` JSON Schema → Zod validation → on failure retry with the errors appended (max 2). Each field is `{ value, evidence }`; missing means `null`
- [x] BullMQ `contract-extraction` queue; separate `worker.ts` entry point
- [x] Contract state machine `uploaded → extracting → needs_review → confirmed | failed`
- [x] Review UI: PDF next to fields with their evidence quotes; edit → confirm → new `ContractTerms` version
- [x] Eval runner v1: field accuracy + payout exactness → markdown report
- [x] Live eval run on the 25 contracts; commit the baseline (`pnpm evals --save-baseline`)

**Done when:** the full flow upload → extract → review → compute works in the UI; the eval report shows per-field accuracy and payout exactness, and the baseline is saved.

**Explain it**
- What does the JSON Schema guarantee, and what does Zod still need to check?
- Why return `null` with no evidence instead of the model's best guess?
- Why generate the PDFs from JSON instead of labeling real contracts by hand?
- Why does extraction run in a worker and not in the HTTP request?

**Break it:** make the prompt worse on purpose (remove the "return null" instruction). Run the evals. Which fields drop, and what does the model invent?

**Status:** done 2026-11-19 (PRs #20–#29, CI green on `main`). Baseline (`packages/evals/baselines/extraction.md`, `claude-opus-5-5`, prompt `extract-v2`): field accuracy 100% (300/300), payout exactness 100% (25/25), 0 failures, 0 retries, 181,836 input / 16,041 output tokens, $1.05 total ($0.042 per contract), 5.8 s per contract. The first live run found two bugs the fakes could not: the output schema had too many nullable fields for the API (#28), and a different list order was logged as a reviewer edit (#29). Upload → extract → review → compute was run end to end with real Claude on case c08 (prompt injection, deposit, amount in words): the extraction ignored the injection and the deposit, and the payout matched to the cent. A perfect score means the dataset is now too easy to tell prompts apart; harder templates are on the Later list. The Explain it questions and the Break it drill are in `SELF_CHECK.md` (deferred).

---

## Phase 4 — Audit agent (F12 traces, F6) (4–5 days)

**Goal:** an agent that reviews a settlement, flags bad expenses and explains every number. The loop is written by hand.

**Tasks**
- [x] `AgentRun` / `AgentStep` tables; record every model call and tool call with tokens
- [x] Tools: `get_settlement`, `get_contract_terms`, `list_expenses`, `list_ticket_sales`, `explain_line`, `recompute_settlement`, `flag_expense`; each with a precise description and input schema
- [x] Agent loop: `stop_reason` handling (`tool_use`, `end_turn`, `max_tokens`), `tool_result` blocks with matching `tool_use_id`, step limit, token budget
- [x] `POST /settlements/:id/ask` streaming over SSE; chat panel in the worksheet showing tool steps
- [x] "Run audit" button: the agent reviews and creates flags; a human resolves them
- [ ] Eval: flag precision/recall against the planted violations in the dataset (runner and oracle done: `pnpm evals:agent`; live baseline and model comparison pending)

**Done when:** on the eval set the agent finds the planted expense violations (record precision/recall), and every answer can be replayed step by step from `AgentStep`.

**Explain it**
- Walk through one full loop iteration: what's in `messages` before and after?
- What happens if a `tool_result` is missing or has the wrong `tool_use_id`?
- Why does the agent call `recompute_settlement` instead of adding numbers itself?
- Why is there no `approve` or `pay` tool? What is the prompt-injection risk in contract text?

**Break it:** (1) remove the step limit and give the agent a tool that always returns "try again". (2) Write a vague tool description. Watch the traces in both cases.

**Status:** done 2026-11-23, except the live eval run. Built: trace tables, the hand-written loop, the seven tools, ask/audit over SSE with the chat panel, flags resolved by a person (open flags block review), the replay page and the agent eval (`pnpm evals:agent`; the oracle scores 100% precision/recall). Every answer can be replayed from `AgentStep`. Live run done 2026-11-24 (Phase 7): `claude-haiku-5-5` scored 100% precision and recall (26/26) for $0.046, saved as `packages/evals/baselines/agent.{json,md}`, and became the default `AGENT_MODEL` (Sonnet and Opus not run, API budget). The Explain it questions and the Break it drill are in `SELF_CHECK.md` (deferred).

---

## Phase 5 — Approval & payments (F7, F8) (4–5 days)

**Goal:** an approved settlement is paid exactly once, even with crashes and duplicate webhooks.

**Tasks**
- [x] Simple login, so approval is tied to a real person (replaces the demo user in `ActorService`, added in Phase 2)
- [x] State machine extended: `in_review → approved → paying → paid`, `payment_failed → paying`; human-only approval; no edits from `paying` onwards
- [x] Stripe test mode: Express connected accounts for seeded artists; fund the test platform balance (Accounts v2 recipients, onboarding from the worksheet)
- [x] Approval transaction: status change + `Payout(pending, idempotencyKey)` + `AuditLog` together
- [x] `payouts` queue: re-read the payout, exit if already done, call `transfers.create` with the idempotency key
- [x] Webhook endpoint: signature verification, `ProcessedWebhookEvent` dedupe, final status update in one transaction
- [x] Sweeper job: find `pending` payouts older than N minutes and re-enqueue them
- [x] Local webhooks with `stripe listen`

**Done when:** all four failure drills below end with exactly one transfer in the Stripe dashboard and a `paid` settlement.

**Explain it**
- A request to Stripe times out. Was the money sent? How does the system find out?
- Why is the webhook, not the API response, the source of truth?
- What would go wrong if the `Payout` row were created *after* the transaction commits?

**Break it (all four):**
1. Kill the worker right after the Stripe call, before the DB update.
2. Replay the same webhook event twice.
3. Click "approve" twice quickly.
4. Send a webhook with a bad signature.

**Status:** done 2026-11-23. Built: login, the payment states with locked inputs, approval + `Payout` in one transaction, the `PaymentGateway` (Stripe / fake), the payout job, the signed and deduped webhook, the sweeper, artist onboarding (Accounts v2) and the worksheet UI. The four drills pass in `test/payouts.test.ts` against a fake Stripe, and were repeated against a real Stripe sandbox: each ended with exactly one transfer and a `paid` settlement (`docs/SYSTEM.md` §8, "Live run"). The first live run found two things the fake could not: Stripe refuses v1 account creation for new platforms, and a fixed idempotency key on account creation replayed an early error. The Explain it questions and the Break it drill are in `SELF_CHECK.md` (deferred).

---

## Phase 6 — Public API & MCP server (F9, F10) (3 days)

**Goal:** other tools, Claude included, can safely read and explain settlements.

**Tasks**
- [x] `/v1` controllers; API keys (show once, store a SHA-256 hash + prefix); rate limiting; OpenAPI via `@nestjs/swagger` (#36–#40; also an API keys page in the web app)
- [x] `apps/mcp` with the official TypeScript SDK, stdio transport; tools `list_shows`, `get_settlement`, `explain_settlement_line`, `flag_expense`, each wrapping one `/v1` endpoint
- [x] Test with MCP Inspector, then Claude Desktop or Claude Code
- [x] README section: how to connect the MCP server

**Done when:** from an MCP client I can ask "why did we pay this artist $X for show Y?" and get a correct, line-by-line answer; the MCP server has no direct DB access.

**Explain it**
- What happens during the MCP handshake (`initialize`, `tools/list`, `tools/call`)?
- Why does the MCP server call the API instead of the database?
- How is an MCP tool different from the tools in my own agent loop?

**Break it:** revoke the API key while the MCP server is running. What does the client see?

**Status:** done 2026-11-23 (PRs #36–#41, CI green on `main`). Built: API keys (hash + prefix, shown once, managed on a web page), the four `/v1` routes with Zod response schemas, a per-key rate limit in Redis, the OpenAPI document (`/v1/docs`), and the MCP server with four tools over stdio. Checked with MCP Inspector, then from Claude Code: asked "why did we pay The Velvet Harbors $12,223.65?", it answered line by line with the amounts of the worksheet and the contract's own words for §4.1 and §6, and said it cannot approve. Break it: after revoking the key, the next tool call failed with the "revoked" error. The drill also showed that revoking stops new calls, not what the model already read: asked the same question again, Claude answered from the earlier tool results without calling the server. The Explain it questions and the Break it drill are in `SELF_CHECK.md` (deferred).

---

## Phase 7 — Hardening & finish (3–4 days)

**Goal:** the project is in its final state: clean, current and runnable from a fresh clone. No presentation work (scope cut 2026-11-24).

**Tasks**
- [x] `evals.yml`: runs on PRs touching prompts/schemas/llm, comments a results table, fails below baseline
- [x] Structured logging (pino) with `requestId` / `jobId` / `settlementId`
- [ ] ~~Go through `DEBUGGING.md`~~ Dropped: the log was removed. Bugs and their fixes are in the PR descriptions and the "as built" notes in `SYSTEM.md`; the Break it drills with what to look for are in `SELF_CHECK.md`.
- [x] README: problem, architecture diagram, key decisions (link SYSTEM.md), eval results table, how to run, MCP setup (the agent eval row and the eval badge follow the live runs)
- [x] Web UI design pass: consistent layout, typography, tables and states across the existing pages. No new features or screens. (Color tokens with dark mode, IBM Plex via `next/font`, active tab and top navigation, payout as the headline number, status badges in four tones.)
- [x] Bind the compose ports to `127.0.0.1` (from Later)
- [x] CI runner upkeep: runner pinned to `ubuntu-24.04`, `pnpm/action-setup` v4 → v6 (runs on Node 24) (from Later)
- [x] Deferred live runs (API budget, last): the Phase 4 agent eval baseline and the `AGENT_MODEL` choice (Haiku, $0.046)
- [ ] ~~2-minute demo video~~ Dropped: no presentation.
- [ ] ~~Final CV bullets~~ Dropped: no presentation.

**Done when:** a fresh clone runs with `docker compose up` + `pnpm dev` from the README; the eval badge/table is current.

**Explain it:** pick any file at random and explain why it exists and what would break without it.

**Status:** done 2026-11-24 (PRs #44–#51). Built: structured logging with pino, the web design pass, the README, compose ports on localhost, CI upkeep, the eval gate (`evals.yml`, first run 300/300 fields and 25/25 payouts for $1.06, posted on #51) and the live agent baseline (Haiku, 100% precision and recall, $0.046; Haiku is the default `AGENT_MODEL`). Fresh clone, checked in a new directory with the README steps (`cp .env.example .env`, `docker compose up -d`, install, migrate, seed, `LLM_CLIENT=fake pnpm dev`): API, worker and web start, the demo login works, a seeded show computes ($2,700.00). The first try found a real bug: turbo's strict env mode dropped `LLM_CLIENT`, so the apps crashed asking for an API key; fixed with `envMode: "loose"` and a CI check (#49). The first eval gate run failed on a mistyped GitHub secret (401 on every call, no cost) and passed after the secret was rewritten from `.env`. The Explain it answers and a Break it drill are in `SELF_CHECK.md`.

---

## Later

Ideas and small follow-ups that came up while building. Not scheduled; pick them up only when a phase needs them.

- ~~Extend the `toFixed` / `parseFloat` lint ban from `settlement-engine` to `apps/api`~~ Done in Phase 2 (also covers `apps/web`).
- Switch `apps/web` back to Turbopack once it can resolve `./x.js` imports to `x.ts` in workspace packages (today `next dev --webpack` with `experimental.extensionAlias`).
- `pg` prints "Calling client.query() when the client is already executing a query is deprecated" during tests. It comes from inside `@prisma/adapter-pg`; recheck when upgrading Prisma.
- Prisma's `latest` npm tag points at 8.0.0-rc; we pin 7.10.1 (stable). Revisit when 8.0 is final.
- Sweeper for contracts stuck in `uploaded` (Redis was down between the DB commit and the enqueue). Same idea as the Phase 5 payout sweeper.
- Check that each evidence quote really appears in the PDF text (needs a PDF text extractor). Today a human checks the quote against the PDF.
- Server-side refusal fallback for extraction (another model when Claude declines). Left off so the eval measures one model; a refusal fails the extraction and a human types the terms.
- Delete or archive the stored PDF of a superseded contract upload (today every upload is kept).
- MCP output schemas use `type: ["string", "null"]` for nullable fields (Zod's JSON Schema). Valid, and Claude reads it, but MCP Inspector's `--strict` warns that single-`type` dialects (e.g. Gemini function declarations) may reject it. Switch to `anyOf` if a non-Claude client needs it.
- `formatNanoUsd` exists twice (api and web) because web cannot import api code. Move it to `packages/schemas` next to `formatCents` if a third user appears.
- Payout recovery (from the final review, see SYSTEM.md §8 "Known recovery limits"): the sweeper retrieves a transfer that has an id but no webhook, and checks Stripe by `metadata.payoutId` before re-sending a payout whose idempotency key is near 24 hours old.
- Close the approve-versus-new-flag window (SYSTEM.md §8): both paths take one `pg_advisory_xact_lock` per show, the same tool the flag dedupe uses.
- UX leftovers from the final review: the engine's line label prints raw categories ("office_supplies is not an allowed category"); the NBOR line's "Computed from" lists the gross sources instead of pointing at the lines above; on a stale settlement the worksheet total is still green; "Upload and extract" could become secondary while a contract waits for review. Also check by hand once that the step tabs update right after a form submit.
- Harder eval contracts: the baseline is 100%, so the eval can no longer show a prompt getting better. Ideas: terms in a table, an amendment that overrides an earlier clause, a percentage of gross instead of net, a term that is truly missing, scanned (image-only) pages.

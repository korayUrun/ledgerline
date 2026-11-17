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
- [ ] Write `docs/domain.md`: deal types (flat, percentage, versus, guarantee plus), GBOR vs NBOR, expense caps, split point, promoter profit, bonus tiers. Work through one hand-calculated example of each type.
- [ ] pnpm workspaces + Turborepo; `apps/web`, `apps/api`, `apps/mcp`, `packages/{settlement-engine,schemas,db,evals}` as empty shells
- [ ] TypeScript strict mode, ESLint (including import-boundary rules from SYSTEM.md §2), Prettier, Vitest
- [ ] `docker-compose.yml` with Postgres + Redis; `.env.example`
- [ ] GitHub Actions `ci.yml`: install → lint → typecheck → test
- [ ] Add `CLAUDE.md`, `PROJECT_OVERVIEW.md`, `FEATURES.md`, `SYSTEM.md`, `PHASES.md`, an empty `DEBUGGING.md`

**Done when:** `docker compose up` starts the DB and Redis; `pnpm test` passes in CI; the hand-calculated examples in `domain.md` are written down.

**Explain it**
- What's the difference between a versus deal and a guarantee-plus deal? When does the artist earn more under each?
- Why does the monorepo forbid `settlement-engine` from importing `db`?

**Break it:** add an `import` from `db` into `settlement-engine` and make sure lint fails.

---

## Phase 1 — Settlement engine (F4) (4–5 days)

**Goal:** the money math is correct and proven before anything else exists.

**Tasks**
- [ ] Zod schemas in `packages/schemas`: `ContractTerms`, `TicketSale`, `Expense`, `SettlementInput`, `SettlementResult`, `SettlementLine`
- [ ] Money helpers: integer cents, basis points, `roundHalfUp`, `applyBps`
- [ ] Pipeline: GBOR → NBOR → allowed expenses (category caps + total cap) → deal formula → bonuses → lines
- [ ] All four deal types + bonus tiers; every line carries `clauseRef` and `sourceRefs`
- [ ] Unit tests: the hand-calculated examples from `domain.md`
- [ ] Property tests (fast-check): payout ≥ 0; versus payout ≥ guarantee; lines reconcile to total; payout monotonic in tickets sold
- [ ] Golden files: `fixtures/*.input.json` → `*.expected.json`

**Done when:** 100% branch coverage on the engine; all property tests pass with 1,000+ runs; the engine has zero runtime dependencies besides `schemas`.

**Explain it**
- Why integer cents and not `number` with decimals? Show a float bug in the REPL.
- Where exactly does rounding happen, and why there?
- What does a property test find that an example test doesn't?

**Break it:** switch one calculation to floats or move a rounding step. Which tests fail, and why?

---

## Phase 2 — Data model, core API & basic UI (F1, F5, F12 audit) (4–5 days)

**Goal:** create a show, import data, enter terms by hand, compute and view a settlement. No AI yet.

**Tasks**
- [ ] Prisma schema (SYSTEM.md §4) + migrations + seed script with 3 demo shows
- [ ] NestJS modules: `shows`, `settlements`, `audit`; CSV import for ticket sales; expense CRUD with receipt upload (local disk)
- [ ] `SettlementStateMachine` service: `draft → computed → in_review` (later states come in Phase 5); every transition writes `AuditLog` in the same transaction
- [ ] Compute endpoint: builds `inputSnapshot`, `inputsHash`, calls the engine, stores the result + lines
- [ ] Stale detection: an input change after compute → `stale`
- [ ] Next.js: show list, show detail, import screen, manual terms form, settlement worksheet with line provenance
- [ ] Integration tests with Testcontainers Postgres

**Done when:** for a seeded show I can enter terms → compute → see a worksheet where every line points to its source; editing an expense marks the settlement stale.

**Explain it**
- Why store `inputSnapshot` when the data is already in other tables?
- What happens if two requests compute the same settlement at the same moment?
- Why must the audit log write be in the same transaction as the status change?

**Break it:** change an expense amount directly in the DB after compute. Does the system notice? How?

---

## Phase 3 — Eval data + contract extraction + review (F11, F2, F3, F8) (5–6 days)

**Goal:** upload a PDF and get correct terms, and *measure* how correct they are from day one.

**Tasks**
- [ ] `packages/evals` generator: random `ContractTerms` → PDF via templates (varied wording, clause order, distractor clauses) + matching sales/expenses → expected payout via the engine
- [ ] Generate 25 contracts; commit the dataset
- [ ] `modules/llm`: Claude client wrapper (model from config, timeout, retry on 429/5xx, token + cost logging)
- [ ] Extraction: PDF → Claude with the `ContractTerms` JSON Schema → Zod validation → on failure retry with the errors appended (max 2). Each field is `{ value, evidence }`; missing means `null`
- [ ] BullMQ `contract-extraction` queue; separate `worker.ts` entry point
- [ ] Contract state machine `uploaded → extracting → needs_review → confirmed | failed`
- [ ] Review UI: PDF next to fields with their evidence quotes; edit → confirm → new `ContractTerms` version
- [ ] Eval runner v1: field accuracy + payout exactness → markdown report

**Done when:** the full flow upload → extract → review → compute works in the UI; the eval report shows per-field accuracy and payout exactness, and the baseline is saved.

**Explain it**
- What does the JSON Schema guarantee, and what does Zod still need to check?
- Why return `null` with no evidence instead of the model's best guess?
- Why generate the PDFs from JSON instead of labeling real contracts by hand?
- Why does extraction run in a worker and not in the HTTP request?

**Break it:** make the prompt worse on purpose (remove the "return null" instruction). Run the evals. Which fields drop, and what does the model invent?

---

## Phase 4 — Audit agent (F12 traces, F6) (4–5 days)

**Goal:** an agent that reviews a settlement, flags bad expenses and explains every number. The loop is written by hand.

**Tasks**
- [ ] `AgentRun` / `AgentStep` tables; record every model call and tool call with tokens
- [ ] Tools: `get_settlement`, `get_contract_terms`, `list_expenses`, `list_ticket_sales`, `explain_line`, `recompute_settlement`, `flag_expense`; each with a precise description and input schema
- [ ] Agent loop: `stop_reason` handling (`tool_use`, `end_turn`, `max_tokens`), `tool_result` blocks with matching `tool_use_id`, step limit, token budget
- [ ] `POST /settlements/:id/ask` streaming over SSE; chat panel in the worksheet showing tool steps
- [ ] "Run audit" button: the agent reviews and creates flags; a human resolves them
- [ ] Eval: flag precision/recall against the planted violations in the dataset

**Done when:** on the eval set the agent finds the planted expense violations (record precision/recall), and every answer can be replayed step by step from `AgentStep`.

**Explain it**
- Walk through one full loop iteration: what's in `messages` before and after?
- What happens if a `tool_result` is missing or has the wrong `tool_use_id`?
- Why does the agent call `recompute_settlement` instead of adding numbers itself?
- Why is there no `approve` or `pay` tool? What is the prompt-injection risk in contract text?

**Break it:** (1) remove the step limit and give the agent a tool that always returns "try again". (2) Write a vague tool description. Watch the traces in both cases.

---

## Phase 5 — Approval & payments (F7, F8) (4–5 days)

**Goal:** an approved settlement is paid exactly once, even with crashes and duplicate webhooks.

**Tasks**
- [ ] State machine extended: `in_review → approved → paying → paid`, `payment_failed → paying`; human-only approval; no edits from `paying` onwards
- [ ] Stripe test mode: Express connected accounts for seeded artists; fund the test platform balance
- [ ] Approval transaction: status change + `Payout(pending, idempotencyKey)` + `AuditLog` together
- [ ] `payouts` queue: re-read the payout, exit if already done, call `transfers.create` with the idempotency key
- [ ] Webhook endpoint: signature verification, `ProcessedWebhookEvent` dedupe, final status update in one transaction
- [ ] Sweeper job: find `pending` payouts older than N minutes and re-enqueue them
- [ ] Local webhooks with `stripe listen`

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

---

## Phase 6 — Public API & MCP server (F9, F10) (3 days)

**Goal:** other tools, Claude included, can safely read and explain settlements.

**Tasks**
- [ ] `/v1` controllers; API keys (show once, store a SHA-256 hash + prefix); rate limiting; OpenAPI via `@nestjs/swagger`
- [ ] `apps/mcp` with the official TypeScript SDK, stdio transport; tools `list_shows`, `get_settlement`, `explain_settlement_line`, `flag_expense`, each wrapping one `/v1` endpoint
- [ ] Test with MCP Inspector, then Claude Desktop or Claude Code
- [ ] README section: how to connect the MCP server

**Done when:** from an MCP client I can ask "why did we pay this artist $X for show Y?" and get a correct, line-by-line answer; the MCP server has no direct DB access.

**Explain it**
- What happens during the MCP handshake (`initialize`, `tools/list`, `tools/call`)?
- Why does the MCP server call the API instead of the database?
- How is an MCP tool different from the tools in my own agent loop?

**Break it:** revoke the API key while the MCP server is running. What does the client see?

---

## Phase 7 — Hardening & presentation (3–4 days)

**Goal:** the project proves itself to someone who has five minutes.

**Tasks**
- [ ] `evals.yml`: runs on PRs touching prompts/schemas/llm, comments a results table, fails below baseline
- [ ] Structured logging (pino) with `requestId` / `jobId` / `settlementId`
- [ ] Go through `DEBUGGING.md`: every drill from Phases 1–6 documented as symptom → layer → root cause → fix
- [ ] README: problem, architecture diagram, key decisions (link SYSTEM.md), eval results table, how to run, MCP setup
- [ ] 2-minute demo video: upload → review → compute → agent flags → approve → paid → MCP question
- [ ] Final CV bullets

**Done when:** a fresh clone runs with `docker compose up` + `pnpm dev` from the README; the demo video is linked; the eval badge/table is current.

**Explain it:** pick any file at random and explain why it exists and what would break without it.

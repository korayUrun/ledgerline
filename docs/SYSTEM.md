# Ledgerline — System Design

This document covers the technical side: the components, how they depend on each other, **why** each one is built the way it is, and how to debug the system when something goes wrong. Feature IDs (F1–F12) refer to `FEATURES.md`.

---

## 1. Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript everywhere | One language across web, API, worker, MCP; shared types and schemas |
| Frontend | Next.js (App Router) + React | Matches the target stack; server components for data-heavy pages |
| Backend | NestJS | Modules + dependency injection give a clear structure for many domains (contracts, settlements, payments) |
| ORM / DB | Prisma + PostgreSQL | Type-safe queries and migrations; Postgres transactions for money state changes |
| Validation | Zod | One schema, used for LLM output validation, API DTOs and JSON Schema generation |
| LLM | Claude API (official TypeScript SDK) | PDF input, tool use, structured output |
| Queue | BullMQ + Redis | Retries, backoff and delayed jobs for LLM calls and payouts |
| Payments | Stripe Connect (test mode) | Platform → connected-account transfers fit "venue pays artist" |
| MCP | `@modelcontextprotocol/sdk` | Official TypeScript SDK |
| Testing | Vitest, fast-check, Testcontainers | Unit, property-based and real-Postgres integration tests |
| Monorepo | pnpm workspaces + Turborepo | Shared packages, cached builds |
| Local infra | Docker Compose + Stripe CLI | Compose runs Postgres and Redis only; the apps run on the host with `pnpm dev` (hot reload, no image rebuilds). No app Dockerfiles: the project runs locally only. Stripe CLI forwards webhooks to localhost |

---

## 2. Repository layout

```
ledgerline/
├─ apps/
│  ├─ web/            Next.js UI (F1, F3, F5, F6 chat, F7 approve)
│  ├─ api/            NestJS: HTTP API (main.ts) + worker (worker.ts)
│  │  └─ src/modules/
│  │     ├─ shows/          F1
│  │     ├─ contracts/      F2, F3
│  │     ├─ settlements/    F4 orchestration, F5, F7 state machine
│  │     ├─ agent/          F6 agent loop, tools, traces (F12)
│  │     ├─ payments/       F7 Stripe + webhooks
│  │     ├─ public-api/     F9 API keys, /v1 controllers
│  │     ├─ audit/          F12
│  │     └─ llm/            Claude client wrapper (retries, token/cost logging)
│  └─ mcp/            MCP server (F10), a thin client of the /v1 API
├─ packages/
│  ├─ settlement-engine/   F4 — pure functions, NO I/O, NO dependencies on db/llm
│  ├─ schemas/             Zod schemas: ContractTerms, SettlementResult, API DTOs
│  ├─ db/                  Prisma schema, migrations, client
│  └─ evals/               F11 — datasets, generators, runner, reports
├─ docker-compose.yml      postgres, redis only (apps run on the host via `pnpm dev`)
└─ .github/workflows/      ci.yml (lint, test), evals.yml (F11 gate)
```

### Dependency rules (enforced with ESLint import rules)

```
web ──HTTP──▶ api ──▶ settlement-engine
mcp ──HTTP──▶ api ──▶ schemas
                 └──▶ db
evals ──▶ settlement-engine, schemas, api/llm (extraction only)
settlement-engine ──▶ schemas   (and nothing else)
```

**Why:** `settlement-engine` is the most important code in the system, so it must be testable in isolation. No database, no network, no clock. If it can't import Prisma, it can't secretly depend on it. `mcp` and `web` never touch the database directly, so business rules exist in exactly one place: `api`.

---

## 3. Component overview

```mermaid
flowchart LR
  subgraph Clients
    WEB[Next.js web]
    CD[Claude Desktop]
  end
  CD -->|MCP stdio| MCP[MCP server]
  WEB -->|REST + SSE| API[NestJS API]
  MCP -->|REST /v1 + API key| API
  API --> ENG[[settlement-engine]]
  API --> PG[(Postgres)]
  API -->|enqueue| R[(Redis / BullMQ)]
  R --> WK[Worker]
  WK --> CL[Claude API]
  API --> CL
  WK --> ST[Stripe]
  ST -->|webhooks| API
  WK --> PG
```

API and worker are **the same NestJS codebase with two entry points**. They share modules, but they scale and fail independently: a slow LLM job can't block HTTP requests, and an API deploy doesn't kill a payout in progress.

---

## 4. Data model (Prisma, simplified)

```
Venue 1─* Show *─1 Artist
Show 1─* TicketSale        (tier, qtySold, priceCents, feeCents, taxCents, comps)
                           qtySold    = paid tickets only; comps are a separate count
                           priceCents = face value per ticket (what lands in the box office;
                                        buyer-paid service fees on top are never included)
                           taxCents, feeCents = tier totals of the tax and deductible fees
                                        contained in that tier's gross (subtracted for NBOR)
Show 1─* Expense           (category, amountCents, receiptKey, status: pending|allowed|disallowed)
Show 1─* Contract          (fileKey, status)
Contract 1─* ContractTerms (version, termsJson, evidenceJson, confirmedBy, confirmedAt)
Show 1─* Settlement        (version, status, termsVersionId, inputSnapshot, inputsHash,
                            engineVersion, payoutCents)
Settlement 1─* SettlementLine (kind, label, amountCents, clauseRef, sourceRefs[])
Settlement 1─0..1 Payout   (idempotencyKey UNIQUE, stripeTransferId, status)
AgentRun 1─* AgentStep     (role, toolName, toolInput, toolOutput, tokensIn, tokensOut)
AuditLog                   (actor, action, entity, entityId, before, after, at)
ProcessedWebhookEvent      (stripeEventId UNIQUE)
ApiKey                     (hashedKey, prefix, lastUsedAt)
```

Key decisions:
- **Money = integer cents.** A single input value (one price, one expense) is capped at `MAX_CENTS` = 1e9 by Zod and stored as `Int`. Columns that hold a *sum* (`SettlementLine.amountCents`, `Settlement.payoutCents`) can exceed Postgres `integer` (≈ 2.1e9), so they are `BigInt` and are converted back to `number` with a safe-integer check at the API edge. **Percentages = basis points** (8500 = 85.00%). No floats anywhere in money paths.
- **ContractTerms are versioned, never overwritten.** A settlement points to the exact terms version it used.
- **`inputSnapshot` + `inputsHash` on Settlement.** The snapshot is a frozen copy of the terms, sales and expenses that went into the engine. Any settlement can be recomputed bit-for-bit later. If live inputs change, the hash no longer matches and the settlement is marked stale.
- **`Payout.idempotencyKey` is UNIQUE** (`payout:{settlementId}:v{version}`). The database itself makes double payment impossible.
- **`ProcessedWebhookEvent.stripeEventId` is UNIQUE.** Stripe can deliver the same webhook more than once, and this table makes processing it a no-op the second time.

As built in Phase 2 (deliberate differences from the sketch above):
- **Tables arrive in the phase that uses them.** Phase 2 has `User`, `Venue`, `Artist`, `Show`, `TicketSale`, `Expense`, `ContractTerms`, `Settlement`, `SettlementLine`, `AuditLog`. `Contract` comes in Phase 3, `AgentRun`/`AgentStep` in Phase 4, `Payout`/`ProcessedWebhookEvent` in Phase 5, `ApiKey` in Phase 6.
- **`ContractTerms` belongs to `Show`**, not to `Contract`: Phase 2 terms are typed in by hand and there is no PDF. Phase 3 adds an optional `contractId`.
- **One settlement per show** (`Settlement.showId` is UNIQUE). `version` counts computes and doubles as the optimistic lock.
- **`User`** exists from Phase 2 so that `AuditLog.actor` and `ContractTerms.confirmedBy` point to a person. Until login exists, the API acts as the seeded demo user. (Replaced by login in Phase 5, see below.)
- **`SettlementLine.sourceRefs` is JSON**, not foreign keys: a line describes the frozen `inputSnapshot`, and live rows may be edited or deleted later.

As built in Phase 3:
- **`Contract`** (`fileKey`, `fileName`, `status`, `extractionJson`, `promptVersion`, `llmUsage`, `failureReason`). The extraction is a *proposal* stored on the contract; it only becomes a `ContractTerms` row when a person confirms it. So every `ContractTerms` version is confirmed by a person, and compute (which reads the latest version) can never use unreviewed terms.
- **`ContractTerms.contractId`** (nullable) links a version to the contract it was confirmed from; `null` means typed in by hand. Evidence quotes stay on `Contract.extractionJson` (there is no `evidenceJson` column).
- **`llmUsage`** holds `{ model, calls, inputTokens, outputTokens, costNanoUsd }`. Cost is integer nano-dollars (1 USD = 10⁹), for the same reason money is integer cents.

As built in Phase 4:
- **`AgentRun`** (`settlementId`, `settlementVersion`, `kind: audit|question`, `question`, `model`, `promptVersion`, `startedBy`, `status: running|completed|failed`, `outcome`, `finalText`, `errorMessage`, token totals, `costNanoUsd`). `settlementVersion` says which numbers the run looked at; a later recompute does not change what it saw.
- **`AgentStep`**: one table for both step kinds, ordered by `position` (`UNIQUE(runId, position)`). A `model_call` row keeps the reply's blocks exactly as received (`content` JSON, thinking and `tool_use` blocks included), its stop reason, tokens, cost and duration; a `tool_call` row keeps `toolUseId`, `toolName`, `toolInput`, `toolOutput` (the exact text sent back) and `isError`. The other kind's columns are null. Replay = `ORDER BY position`.
- **Run totals are updated in the same transaction as each model-call step**, so they always equal the sum of the stored steps, even after a crash. An unknown price makes `costNanoUsd` NULL and it stays NULL (SQL `NULL + x` is `NULL`): never a misleading $0.
- **`ExpenseFlag`** (`expenseId`, `agentRunId`, `kind: category_not_allowed|over_category_cap|other`, `reason`, `status: open|accepted|dismissed`, `resolvedById`, `resolvedAt`). A flag is a note, not an input: it never changes the expense or makes the settlement stale. Open flags block submit-for-review, like pending expenses, and approval (a flag can still be opened during review). (Phase 6: `agentRunId` became nullable and `apiKeyId` was added, for flags opened through `/v1`.)

As built in Phase 5 (login):
- **`User.passwordHash`** (`scrypt$<salt>$<hash>`, Node's built-in scrypt; null = cannot log in) and **`Session`** (`userId`, `tokenHash` UNIQUE, `expiresAt`, 7 days). The token is 32 random bytes; only its SHA-256 is stored, so a leaked row cannot be used to log in. Logout deletes the row, which kills the token everywhere.
- **Every API route needs a session unless it is `@Public()`** (health, login). A global `AuthGuard` reads `Authorization: Bearer <token>`, loads the user and attaches the actor; controllers take it with `@CurrentActor()`. Closed by default: a new endpoint is protected without anyone remembering to protect it. Wrong email and wrong password give the same 401 message.
- **Web:** the login server action stores the token in an httpOnly, SameSite=Lax cookie (page JavaScript cannot read it), and every call from the Next.js server to the API sends it as the bearer token. A 401 from the API redirects to `/login`. The browser still never calls the API.

As built in Phase 6 (API keys):
- **`ApiKey`** (`name`, `prefix` UNIQUE, `keyHash` UNIQUE, `createdById`, `lastUsedAt`, `revokedAt`). The key is `ll_<prefix>_<secret>`: 4 random bytes as 8 hex characters, then 32 random bytes. Only the SHA-256 of the whole key is stored (the column is `keyHash`, like `Session.tokenHash`); the prefix is stored in clear so a person can tell keys apart. Revoking sets `revokedAt` and keeps the row for the audit log. `lastUsedAt` is written at most once a minute.
- **Each route has exactly one way in** (`AuthGuard`): `@Public()`, `@ApiKeyAuth()` (the `/v1` routes, API key only) or, by default, a logged-in session. A key on a session route and a session token on `/v1` are both 401. Approve and pay are session routes, so no key can reach them.
- **Two actor types:** `Actor` (a person, `user:<id>`) and `ApiKeyActor` (`api_key:<id>`). The approval and payment services take `Actor`, and an `ApiKeyActor` has no `userId`, so passing one does not compile.
- **Keys are managed by a person** through session routes: `GET /api-keys`, `POST /api-keys` (the only response that contains the key), `POST /api-keys/:id/revoke`. Audit actions `api_key.created` and `api_key.revoked`, never with the key.
- **Web page `/settings/api-keys`** (link in the top bar): create, list (prefix, last used, status) and revoke. The new key comes back from the server action as `useActionState` state and is shown in a client component: never in a URL (browser history, logs) or a cookie, and gone on reload.

---

## 5. State machines

**Contract:** `uploaded → extracting → needs_review → confirmed` (`extracting → failed` on repeated errors)

As built (`apps/api/src/modules/contracts/contract-state-machine.ts`): `confirmed` and `failed` are final. A failed or wrong extraction is not retried in place; the user uploads the PDF again (a new `Contract` row), so every attempt stays in the history. Transitions use the same pattern as settlements: a guarded table, a compare-and-set `UPDATE … WHERE status = <expected>`, and the `AuditLog` row in the same transaction. Audit actions: `contract.uploaded`, `contract.extraction_started`, `contract.extracted`, `contract.extraction_failed`, `contract.confirmed` (with `reviewerEdited`: did the person change what Claude proposed?).

**Settlement:**
```
draft → computed → in_review → approved → paying → paid
              ↑         │                    │
              └─ stale ◀┘ (inputs changed)    └─▶ payment_failed → (retry) paying
```

**Payout:** `pending → processing → succeeded | failed`

Phase 2 implements `draft → computed → in_review` and `→ stale` (`apps/api/src/modules/settlements/settlement-state-machine.ts`). `computed → computed` (recompute with unchanged inputs) is allowed; `in_review` must go `stale` before it can be recomputed.

Stale detection has two layers. (1) Every service that changes an input (ticket sales, expenses, terms) calls `onInputChange` in the same transaction. (2) Reading a settlement re-hashes the live inputs and compares with `inputsHash`, which also catches changes made around the API (manual SQL, bugs).

Pending expenses are included in the math (a preview) but block `computed → in_review` until each one is allowed or disallowed.

Phase 5 adds the payment states (`settlement-state-machine.ts`): `in_review → approved → paying → paid | payment_failed`, `payment_failed → paying` (a person retries), and `approved → paid` only for a $0 payout (Stripe cannot transfer nothing). `paid` has no way out. From `approved` on, the inputs are **locked**: `onInputChange` (called by every input-changing service in the same transaction) answers 409, so the edit rolls back instead of making the settlement stale; recompute is refused by the transition table.

Rules:
- Transitions happen only through one `SettlementStateMachine` service, never via ad-hoc `UPDATE status`. Each transition writes an `AuditLog` row **in the same DB transaction**.
- `approved` requires a human user. Agents and API keys cannot approve.
- `paying` and later are terminal for edits: inputs can't change once money is moving.

**Why:** Payment bugs are almost always "illegal state" bugs: paying a stale settlement, approving twice, editing after approval. A single guarded state machine makes these impossible instead of merely unlikely.

---

## 6. Settlement engine (F4)

**Signature:** `computeSettlement(input: SettlementInput): SettlementResult`. Pure and synchronous.

**Pipeline:**
1. `GBOR` (gross box office) = Σ qtySold × priceCents  (comps are not in `qtySold`, so they add nothing)
2. `NBOR` (net box office) = GBOR − Σ taxCents − Σ feeCents
3. `allowedExpenses` = expenses filtered by contract categories, each category capped, then the total expense cap applied
4. Deal formula:
   - **Flat:** `payout = guarantee`
   - **Percentage:** `payout = pct × NBOR`
   - **Versus:** `payout = max(guarantee, pct × (NBOR − allowedExpenses))`
   - **Guarantee plus:** `splitPoint = allowedExpenses + guarantee + promoterProfit`, where `promoterProfit = profitPct × (allowedExpenses + guarantee)`; `payout = guarantee + pct × max(0, NBOR − splitPoint)`
5. Bonuses: tiers by tickets sold (cumulative or highest-only, as the contract specifies)
6. Every intermediate value is emitted as a `SettlementLine` with `clauseRef` and `sourceRefs`

**Rounding:** all math in integer cents. Percent of an amount = `roundHalfUp(amount × bps / 10000)`, applied once per line. The rule is documented and tested.

**Tests:**
- Unit tests: one hand-calculated example per deal type.
- Property-based tests (fast-check), invariants:
  - versus payout ≥ guarantee
  - payout never negative
  - sum of lines reconciles to payout
  - payout is monotonic in tickets sold
- Golden files: input JSON → expected result JSON, reviewed by hand once.

**Why so strict:** this is the only code that decides how much money moves. Everything else (LLM, UI, API) can be wrong in recoverable ways. This must not be.

---

## 7. LLM layer

All Claude calls go through `modules/llm`, which handles:
- the model chosen per task from config (a stronger model for extraction, a cheaper one for simple classification),
- timeouts, retries with backoff on 429/5xx,
- logging tokens and cost per call (feeds into F12).

As built (`apps/api/src/modules/llm/`):
- `LlmClient` is a one-method interface (`createMessage`). `AnthropicLlmClient` uses the official SDK; `FakeLlmClient` is scripted for tests and offline runs.
- The model comes from config per task: `EXTRACTION_MODEL` (default `claude-opus-5-5`) and `AGENT_MODEL` (default `claude-haiku-5-5`, chosen by the agent eval, see §11). Retries on 408/409/429/5xx and dropped connections are the SDK's own (`maxRetries`, exponential backoff, honours `Retry-After`); we configure them instead of writing a second retry loop. Timeout `LLM_TIMEOUT_MS` (120 s).
- Every call logs task, model, stop reason, tokens, cost and duration. Prompt and reply text are never logged.
- The worker and, since Phase 4, the HTTP API read `ANTHROPIC_API_KEY`: the worker for extraction, the API for the audit agent (it runs in the request so its steps can stream to the browser). `LLM_CLIENT=fake` runs both without a key: every extracted field comes back missing (a person types the terms) and the agent answers that it is offline.

### 7.1 Contract extraction (F2)

```
PDF ──▶ Claude (document input + ContractTerms schema)
     ──▶ Zod.parse ──fail──▶ retry with validation errors appended (max 2)
                   ──ok────▶ ContractTerms v1 (status: needs_review)
```

- Output schema = `ContractTermsSchema` from `packages/schemas`, converted to JSON Schema. It's enforced through the API's structured-output support (or a forced tool call). Then it's **validated again with Zod**, because we never trust the shape blindly.
- Every field is `{ value, evidence: { quote, page } | null }`. The prompt says: if the contract doesn't state it, return `null`; do not infer.
- Runs as a BullMQ job (`contract-extraction`), because it takes seconds and can fail.

**Why the re-validation and retry:** the schema prevents most malformed output, but business validation (e.g., a percentage between 0 and 10000 bps, a guarantee present for a versus deal) needs code. Feeding the errors back gives the model a precise chance to fix itself.

As built (`apps/api/src/modules/contracts/extraction/`, `packages/schemas/src/contract-extraction.ts`):
- The output schema is `ContractExtractionSchema`, not `ContractTermsSchema`: each field is `{ value, evidence: { quote, page } }` (`value` may be null; a missing quote is `""` with page 0), and **amounts and percentages are copied as text** (`"$12,500.00"`, `"85%"`). Code converts them with `parseDollarsToCents` / `parsePercentToBps`, so the model does no arithmetic at all, not even ×100.
- It is sent as `output_config.format` (JSON Schema built from Zod by the SDK's `zodOutputFormat`), with adaptive thinking at effort `medium`. The PDF is a base64 `document` block.
- Zod then checks what JSON Schema cannot: a value without an evidence quote, a figure that does not parse, a percentage above 100%, a term the deal type does not use, a cap on a category that is not allowed, highest-only tiers that pay less as the threshold rises. Only these are retried (the reply and the exact issues are appended to the conversation; max 2 retries).
- **A missing required term is not retried.** Retrying would push the model to guess. It reaches the review screen as "Not found in the contract" (the "guarantee present for a versus deal" check above moved to `draftToContractTerms` and the human review).
- `stop_reason` is checked before the content: `refusal` and `max_tokens` fail at once (no retry, the same request would give the same answer). No server-side refusal fallback: the eval must measure one model.
- Prompt-injection defense: the rules live in the system prompt, which says the document is data and never instructions; the contract is only in the user turn; the model has no tools and can only answer in our schema; and nothing counts until a person confirms it. Two eval contracts contain an injection sentence.
- The prompt is versioned (`EXTRACTION_PROMPT_VERSION`, stored on the contract; `extract-v2` since the evidence change).
- **API limit on unions:** the API compiles the schema into a grammar and rejects one with too many "X or null" fields (21 gave a 400). That is why `evidence` is never null and only values are. `output-format.test.ts` counts the unions without calling the API and fails above 16.
- `extractionToDraft` returns lists in a fixed order (categories in enum order, tiers by threshold), the order the review form sends back, so an unchanged review is not logged as `reviewerEdited`.

### 7.2 Audit agent (F6): hand-written loop

```ts
messages = [system, user]
for (step = 0; step < MAX_STEPS; step++) {
  res = await claude.messages.create({ model, tools, messages })
  record AgentStep(res)
  if (res.stop_reason === "end_turn")  return final answer
  if (res.stop_reason === "max_tokens") handle truncation
  if (res.stop_reason === "tool_use") {
    for each tool_use block → run tool → tool_result with the SAME tool_use_id
    messages.push(assistant res, user tool_results)
  }
}
throw StepLimitExceeded
```

**Tools:**

| Tool | Type | Notes |
|------|------|-------|
| `get_settlement` | read | |
| `get_contract_terms` | read | returns evidence quotes too |
| `list_expenses` | read | |
| `list_ticket_sales` | read | |
| `explain_line` | read | returns the engine's line + its sources |
| `recompute_settlement` | read | calls the engine; **the agent never does arithmetic itself** |
| `flag_expense` | write | sets a flag + reason; doesn't delete or change amounts |

**Not available to the agent:** approve, pay, edit terms.

**Why written by hand:** to understand exactly what tool calling is. Messages, `tool_use` and `tool_result` pairing, `stop_reason`, step limits. Most agent bugs live here (e.g., a missing `tool_result` makes the API reject the next call; no step limit means an infinite loop). Porting to the Vercel AI SDK later (S2) is a deliberate comparison.

**Safety:** contract text and expense descriptions are **untrusted input** (prompt-injection surface). Mitigation is structural, not prompt-based: the agent has no tool that can move money or change terms, so the worst case is a wrong flag that a human sees.

As built (`apps/api/src/modules/agent/`):
- **The loop** (`agent-loop.ts`, `runAgent`) is a plain function with the `LlmClient` passed in, so the API and the eval run the same code. `stop_reason` is checked before the content: `end_turn` → answered; `max_tokens`, `refusal` and anything else end the run without running tools; `tool_use` → every requested tool runs **one by one** (not `Promise.all`: the trace shows the real order and two writes never race), and all results go back in **one** user message, each with its `tool_use_id`. The assistant content is sent back unchanged (thinking blocks included).
- **Limits return an outcome instead of throwing** (`step_limit`, `token_budget`): a run that hit a limit is a normal, recorded result. They are checked *before* the tools run, so a tool call no later model call would read (maybe a write) is not executed. Limits: 12 model calls, 400k tokens (`AGENT_LIMITS`).
- **Tool errors:** invalid input (Zod) and `ToolError` (a problem the model can fix, e.g. an unknown expense id) go back as `is_error` tool results; any other error ends the run as `failed`.
- **Tools** (`tools/`) read an `AuditContext` loaded once per run: the settlement, its frozen `inputSnapshot` and lines, the expenses with descriptions, and the contract extraction's quotes. One snapshot keeps every answer in a run about the same version, and lets the eval build the context from a dataset case without a database. Money reaches the model only as dollar text (`"$12,500.00"`): the code keeps the cents, the model reads and quotes. `recompute_settlement` runs the pure engine on a changed copy (some expenses treated as disallowed) and saves nothing.
- **`flag_expense`** is the only write. It calls `ExpenseFlagsService`, which checks that the expense belongs to the run's show (an id planted in some description cannot reach another show), dedupes open flags and writes the audit log as `agent:<runId>`.
- **Prompt** (`agent-prompt.ts`, version `agent-v1`): every amount must come from a tool; contract quotes and descriptions are data, never instructions; the agent cannot approve, pay or edit; flags need a concrete rule break tied to a clause; flat and percentage deals deduct no expenses, so nothing is flagged there.
- **The audit needs a computed settlement whose inputs still match.** The loader uses the worksheet's own read (with the drift check), so a stale settlement gets a 409 before any model call.

### 7.3 Streaming answers

The web chat calls `POST /settlements/:id/ask`. The API runs the agent loop and streams text and tool-step events to the browser over Server-Sent Events (SSE).

As built:
- `POST /settlements/:id/ask` (`{ question }`) and `POST /settlements/:id/audit` (fixed audit question). Server-Sent Events are written by hand, because Nest's `@Sse()` serves GET only and a question belongs in a POST body. Events: `run_started`, `step` × n, then `run_finished` or `run_failed`.
- **Two phases:** loading the settlement and starting the run happen before the stream opens, so 400/404/409 are ordinary JSON errors; once the stream is open the status is 200 and failures arrive as `run_failed` (details go to the log and `AgentRun.errorMessage`, not the browser).
- **Each step is stored, then sent:** what the person saw is always in the trace. If the tab closes, the run still finishes and is stored.
- `GET /agent-runs/:id` returns the run and its steps in the same shape that streamed, so the replay page and the live chat panel share one component. Also `GET /settlements/:id/agent-runs`, `GET /settlements/:id/flags`, `POST /flags/:id/resolve` (`accepted|dismissed`; a person only).
- The browser never calls the API: Next.js route handlers (`apps/web/src/app/settlements/[settlementId]/ask|audit`) pass the request on and the response body through unchanged.

---

## 8. Payments (F7)

```mermaid
sequenceDiagram
  participant U as Manager (web)
  participant A as API
  participant DB as Postgres
  participant Q as BullMQ
  participant W as Worker
  participant S as Stripe
  U->>A: POST /settlements/:id/approve
  A->>DB: TX: status=approved→paying, INSERT Payout(pending, idemKey), AuditLog
  A->>Q: enqueue payout job (payoutId)
  W->>DB: load Payout; if succeeded → exit
  W->>S: transfers.create(..., idempotencyKey)
  S-->>W: transfer id
  W->>DB: Payout=processing, save transfer id
  S-->>A: webhook (signed)
  A->>DB: TX: dedupe event id, Payout=succeeded, Settlement=paid, AuditLog
```

**Why each piece:**
- **The Payout row is written in the same transaction as approval.** Approval and "intent to pay" can't diverge. If the process crashes after commit, the job (or a sweeper) finds the pending payout. This is the outbox idea in its simplest form.
- **Idempotency key on the Stripe call.** If the worker times out and retries, Stripe returns the original transfer instead of creating a second one.
- **Webhook = source of truth for final status.** The API response says "accepted"; the webhook says "done".
- **Signature verification + event-id dedupe.** Forged and duplicate webhooks are rejected or ignored.
- **Test mode setup:** create Express connected accounts for test artists; fund the platform's test balance with test charges; forward webhooks locally with `stripe listen`.

As built (Phase 5, `apps/api/src/modules/payments/`):
- **Approval** (`POST /shows/:id/settlement/approve`, logged-in person only) is one transaction: `in_review → approved` (audit `settlement.approved`), the `Payout` row (attempt 1, `pending`), `approved → paying` (audit `settlement.payment_started` with the payout id and key). It re-checks the inputs hash first; the read before it also runs the drift check, so changed data turns the settlement stale and the approval gets a 409. It also refuses while any expense flag is open: an API client or a running audit can open one during review, and a person decides on each before money moves. Known limit: a flag committed in the same instant as the approval can slip past, because under READ COMMITTED neither transaction sees the other. Closing it would need a row lock (`SELECT … FOR UPDATE`) on the settlement in both paths; it is accepted because a person clicks Approve and the window is milliseconds.
- **Two approvals at once:** both read `in_review`; the compare-and-set lets one UPDATE match, the other gets a 409 and its transaction (with its Payout insert) rolls back. Tested with two concurrent requests: exactly one payout.
- **`Payout`**: one row per attempt, `idempotencyKey = payout:<settlementId>:v<version>:a<attempt>` (UNIQUE), `UNIQUE(settlementId, attempt)`, `amountCents` copied from the approved settlement. A retry (`POST …/retry-payment`, only from `payment_failed`, only after a failed payout) is a new row with a new key, because Stripe answers a repeated key with the first answer.
- **Before approving**, the API checks that Stripe is configured (503 otherwise) and that the artist has a connected account (409 otherwise), so nothing is approved that can only fail. The job is enqueued **after** the commit; if Redis is down at that moment the approval still stands and the sweeper picks the payout up.
- **`PaymentGateway`** is the app's view of the provider (`createTransfer`, `createConnectedAccount`, `createOnboardingLink`). `StripeGateway` is the real one (`stripe` 23.1.0, test keys only: a non-`sk_test_` key stops the app at startup; a rejected key answers 503); `FakePaymentGateway` copies the behaviour the code relies on (a repeated idempotency key returns the first transfer) and can script a refusal, a timeout, or a crash right after the transfer.
- **The payout job** (`payouts` queue, job id = payout id, 5 attempts, exponential backoff) re-reads the payout and stops if it is `succeeded`/`failed` or already has a transfer id; otherwise `pending → processing` (audit `payout.processing_started`, written only by the call that made the change), then `transfers.create` with the payout's key and `metadata.payoutId`, then saves the transfer id (still `processing`). Errors are sorted in one place: a definite "no" from Stripe (invalid request, permission, idempotency mismatch) fails the payout and the settlement (`payment_failed`); a rejected key is a setup error; **everything else (timeout, connection, 5xx, 429) is retried with the same key and the payout is never marked failed**, because the money may have moved and a person's retry would use a new key.
- **The webhook** (`POST /payments/webhook`, public, `stripe listen` forwards it locally) verifies the signature over the raw request bytes (`rawBody: true`), then in one transaction: insert the event id into `ProcessedWebhookEvent` (a duplicate hits the primary key and is answered `duplicate`), find the payout by the transfer's `metadata.payoutId` (so it works even if it arrives before the job saved the transfer id), refuse a transfer whose amount differs from the payout, and mark `succeeded` + settlement `paid`. For a transfer between Stripe balances the confirming event is `transfer.created` (Stripe has no paid/failed events for transfers); `transfer.reversed` is recorded and logged, handling it is out of scope.
- **The sweeper** (a BullMQ job scheduler, every minute, in the worker) re-enqueues payouts untouched for 5 minutes that are `pending`, or `processing` without a transfer id. One with a transfer id is waiting for the webhook and is left alone.
- **The four drills** run in `test/payouts.test.ts` against the fake: worker killed after the Stripe call (the retry gets the same transfer back), the same webhook twice, approve clicked twice, a bad signature. Each ends with one transfer and a paid settlement.

- **Connected accounts use Accounts v2** (`stripe.v2.core.accounts.create`): Stripe refuses v1 account creation for new Connect platforms. The artist is a *recipient* (`configuration.recipient` with the `stripe_balance.stripe_transfers` capability), Express dashboard, US individual; a recipient needs a contact email, so a placeholder on `example.com` is used (synthetic data). Onboarding uses a v2 Account Link. The transfer itself stays `transfers.create` (v1) with the `acct_…` id.
- **No idempotency key on account creation.** Found in the first live run: a fixed key per artist made Stripe replay the first answer, an error ("Connect not enabled"), on every later click. Stripe saves a key's first result, errors included. Double clicks are handled in the database instead (`UPDATE … WHERE stripeAccountId IS NULL`). The payout's key is different on purpose: there, replaying the first answer is exactly what makes a retry safe, and a definite failure gets a new attempt with a new key.

**Stripe test mode setup** (once, needs a free Stripe account; a sandbox works and keeps test data apart):
1. Enable Connect in the sandbox: Dashboard → Connect → Get started → "You collect payments and pay recipients" (marketplace).
2. `.env`: `STRIPE_SECRET_KEY=sk_test_…` from the same sandbox (Developers → API keys), `STRIPE_WEBHOOK_SECRET=whsec_…` from step 3, optional `WEB_URL` (default `http://localhost:3000`).
3. Install the Stripe CLI locally (`brew install stripe/stripe-cli/stripe`; the dashboard's browser shell cannot reach localhost), `stripe login` into the same sandbox, then `stripe listen --events transfer.created,transfer.reversed --forward-to localhost:<API_PORT>/payments/webhook` and keep it running (newer CLIs require `--events`).
4. Fund the platform balance with an immediately available test charge: a PaymentIntent with `pm_card_bypassPending` (or the card `4000 0000 0000 0077` in the dashboard). Transfers draw from the available balance.
5. In the app: worksheet → **Connect Stripe account** → Stripe's onboarding with test data (bank account `110000000` / `000123456789`) → **Approve and pay**.

**Live run (2026-11-23, sandbox):** a $150 flat-deal settlement was approved and paid end to end (transfer `tr_1Uew28…`, settlement `paid` by the `transfer.created` webhook, under 2 s). The four drills were repeated against real Stripe: (1) the same payout sent twice with one idempotency key returned the same transfer, and the restarted worker skipped the queued job ("nothing to do (succeeded)"); (2) the real event delivered twice more answered `duplicate`, one `settlement.paid` audit row; (3) two simultaneous approvals gave 200 and 409, one payout; (4) a wrong secret and a body changed after signing both got 400. Each settlement has exactly one transfer in Stripe.

---

## 9. Background jobs (F8)

| Queue | Job | Retries | Idempotent because |
|-------|-----|---------|--------------------|
| `contract-extraction` | extract terms for a contract | 3, exponential | writes a new terms version; re-running is harmless |
| `payouts` | send transfer for a payout; `sweep` every minute | 5, exponential | Stripe idempotency key + status check before calling |
| `evals` (optional) | run eval suite | 0 | read-only |

Every job handler starts by **re-reading state from the DB** and exiting if the work is already done. Jobs carry IDs, not data, so they never act on stale copies.

As built for `contract-extraction` (Phase 3):
- The API enqueues **after** the DB commit (the worker can never get a job for a row it cannot see yet), with `jobId = contractId`, so a second add for the same contract is ignored. If Redis is down at that moment, the contract stays `uploaded` and the client gets a 503 (a sweeper is on the Later list).
- The worker (`src/worker.ts`, a Nest application context with no HTTP) re-reads the contract and exits unless it is `uploaded` or `extracting`; `extracting` is a valid start, because a crash during the Claude call leaves it there.
- An extraction that the extractor gave up on (invalid output after its own retries, refusal, truncation) is **final**: the job does not retry, because that would repeat the bill for the same answer. Other errors (network after the SDK's retries, DB, missing file) are rethrown so BullMQ retries them; on the last attempt (`job.attemptsStarted >= attempts`) the contract is marked `failed` first.
- `pnpm dev` runs `turbo run dev dev:worker`: the API and the worker are separate processes.

---

## 10. Public API (F9) & MCP server (F10)

- `/v1/shows`, `/v1/settlements/:id`, `/v1/settlements/:id/lines`, `/v1/settlements/:id/explain`, `/v1/expenses/:id/flag`
- API keys: random secret shown once; only a SHA-256 hash and a prefix are stored. Rate-limited.
- OpenAPI generated with `@nestjs/swagger`.

As built (`apps/api/src/modules/public-api`, schemas in `packages/schemas/src/public-api.ts`):

| Route (API key only) | Returns |
|---|---|
| `GET /v1/shows` | `{ data: [...] }`, newest show first, each with its settlement id, status and payout |
| `GET /v1/settlements/:id` | status, show, payout, the worksheet lines (with `position`), payment attempts, open flag count |
| `GET /v1/settlements/:id/lines/:position` | one line with the input rows it was computed from (from the frozen `inputSnapshot`) and the contract clause behind it: the confirmed terms as name/value text, plus the PDF quotes when the terms came from an extraction |
| `POST /v1/expenses/:id/flags` | opens an expense flag (201), or returns the same open flag (200); 409 once the settlement is approved |

- **Lines are part of the settlement**, so the planned separate `/lines` list became the `lines` field, and `/explain` became the line resource itself (`/lines/:position`). The MCP tools map one-to-one: `list_shows`, `get_settlement`, `explain_settlement_line`, `flag_expense`.
- **The explanation is collected, not written.** No LLM runs on the API side: the code gathers the facts (rows, terms, quotes), and the client's model (Claude through MCP) puts them into sentences. That keeps every number in the answer one the engine produced and costs nothing per call.
- **Money is `{ cents, formatted }`.** Programs use the integer, language models quote the text instead of converting cents themselves.
- **Every response is parsed with its Zod schema before it is sent.** A mismatch is our bug, so it is a 500, not a 422.
- **Reads go through `SettlementsService.getView`**, so they run the drift check: a client never sees old numbers labelled as current (they come back `stale`).
- **Rate limit:** `V1_RATE_LIMIT_PER_MINUTE` requests per API key per clock minute (default 60), counted in Redis with `INCR` + `PEXPIRE` in one `MULTI` (`rate-limiter.ts`). Over the limit: 429 with `Retry-After`; every response has `X-RateLimit-Limit` and `X-RateLimit-Remaining`. A fixed window, not a sliding one: up to twice the limit can pass around a minute boundary, which is fine for a capacity guard. Hand-written rather than `@nestjs/throttler` (in-memory by default, one more dependency). If Redis cannot be reached, requests are allowed and a warning is logged (fail open): the API key is the security boundary, the limit only protects capacity. Session routes (the web app) are not limited.
- **OpenAPI** (`openapi.ts`): `GET /v1/openapi.json`, browsable at `/v1/docs`, public (shapes only, no data). Built by `@nestjs/swagger` from the `Api*` decorators on `V1Controller`; response shapes come straight from the Zod schemas, which implement Standard JSON Schema (`@ApiOkResponse({ standardSchema })`), so the document and the runtime check cannot drift. Only `PublicApiModule` is scanned and `/api-keys` is excluded: the document lists exactly what a key can call. Path parameter types are written by hand (`@ApiParam`), because tsx/esbuild emits no TypeScript type metadata.
- **Flags from an API key** are stored with `apiKeyId` (`agentRunId` stays null); a CHECK constraint makes sure exactly one of the two is set. Audited as `api_key:<id>`. Like the agent's flags, they block submit-for-review and approval until a person resolves them.

**MCP server:** a separate small process using the official SDK, with stdio transport for Claude Desktop. Each MCP tool is a thin wrapper over one `/v1` endpoint, with a clear description and an input schema.

**Why MCP → API instead of MCP → DB:** the same auth, validation, state machine and audit log apply. The MCP server has no special powers and holds no business logic.

MCP server as built (`apps/mcp`, `@modelcontextprotocol/sdk` 1.32.2; how to connect it: `README.md`):

- **Files:** `config.ts` reads `LEDGERLINE_API_URL` and `LEDGERLINE_API_KEY` (from the MCP client's config, not the repo's `.env`); `api-client.ts` is the only way out (HTTP to `/v1` with the key); `tools/*.ts` register one tool each; `server.ts` builds the server without a transport; `index.ts` adds stdio. Tests connect a real MCP client in memory (`InMemoryTransport`), so they go through `initialize`, `tools/list` and `tools/call` like Claude Desktop does.
- **The handshake:** the client sends `initialize` (its protocol version and capabilities); the server answers with its name, its capabilities (`tools`) and `instructions`, guidance for the model about the whole server (find the settlement, then the lines, then explain; quote `formatted`, never compute; cannot approve or pay). Then `tools/list` returns each tool's name, description, input and output JSON Schema (converted from Zod) and annotations, and `tools/call` runs one.
- **Each tool = one route,** with an input schema (`z.uuid()` for ids, which also keeps them safe in the URL path; `position` an integer ≥ 0) and an output schema that is the API's own `/v1` Zod schema. The SDK checks the arguments before the handler runs (a bad one comes back as an error result the model can fix, and no request is sent) and the structured result after.
- **Two checks on every answer:** the API client parses it with the `/v1` schema (a wrong URL can reach another server that also answers 200), and the SDK checks it against the tool's output schema.
- **Errors are results, not crashes.** An `ApiRequestError` (401, 429, 404, 409, unreachable) becomes `isError: true` with a sentence the model can repeat: a revoked key says to create a new one; a rate limit gives the seconds to wait; a 404 passes on the API's message (e.g. the valid line range). Anything else is a bug and is thrown.
- **Every result has both forms:** `structuredContent` (typed, checked) and the same JSON as text in `content`, which is what most clients show the model.
- **Annotations:** the three readers are `readOnlyHint: true`; `flag_expense` is `readOnlyHint: false, destructiveHint: false, idempotentHint: true` (the API returns the same open flag). Annotations are hints for the client's UI, not security: the security is the API key and the routes it can reach.
- **stdout is the protocol channel.** Every byte there must be a JSON-RPC message, so logs go to stderr, and ESLint bans `console.log` / `process.stdout` in `apps/mcp`.
- **MCP tools vs the agent's tools (F6):** the agent's tools run inside the API, in a loop we wrote, with the model we chose, on a context loaded once per run. MCP tools are offered to someone else's model (Claude Desktop) through a standard protocol; they only call the public API with a key, so they get exactly the powers of that key.
- **Checked by hand** with MCP Inspector 2.14.0 (`--cli`) over stdio against the running API: the four tools list with their annotations; list → settlement → explain a deal line (confirmed terms and the PDF quotes) and an expense line; a flag is created, then returned (`created: false`) on the second call; after revoking the key, the next call returns the "revoked" error. Then from Claude Code (the phase's "Done when"): a correct line-by-line answer to "why did we pay The Velvet Harbors $12,223.65?", citing §4.1 and §6 with the PDF's words; after revoking, a new tool call failed with the "revoked" error, while the same question was answered again from the earlier results (revoking stops new access, not what was already read).

---

## 11. Evals (F11)

**Dataset generation (ground truth by construction):**
1. Randomly generate `ContractTerms` JSON (the ground truth).
2. Render it into a contract PDF with templates: varied wording, clause order, layouts, and distractor clauses (e.g., a hospitality rider with numbers that are *not* deal terms).
3. Generate matching ticket sales and expenses; plant some violations (an over-cap category, a disallowed category) with known labels.
4. Expected payout = `settlement-engine(groundTruth)`.

**Metrics:**

| Metric | How |
|--------|-----|
| Field accuracy | exact match per field (`dealType`, `guaranteeCents`, `pctBps`, …) and an aggregate |
| Payout exactness | % of contracts where extracted terms → engine payout == expected, to the cent |
| Agent flags | precision / recall against planted violations |
| Cost / latency | tokens and seconds per contract |

**CI:** `evals.yml` runs on PRs that touch prompts, schemas or the llm module. It posts a results table as a PR comment and fails if field accuracy or payout exactness drops below the last baseline. Results are stored per run, so accuracy is tracked across releases.

**Why generate PDFs from JSON instead of labeling by hand:** labels are free and always correct, and it's easy to add hard cases on purpose.

As built (`packages/evals/`):
- **Dataset:** 25 cases in `dataset/cNN/` (`case.json` ground truth, `contract.pdf`, `contract.txt`), generated from fixed seeds by `pnpm --filter @ledgerline/evals generate`. Output is byte-for-byte deterministic (pdfkit with a fixed creation date), and a test fails if the committed dataset no longer matches the generator. Deal types rotate (7/6/6/6). Hard features are tagged per case: `deposit_distractor`, `merch_percent_distractor`, `money_in_words`, `cents_in_guarantee`, `sub_clauses`, `no_total_cap`, `prompt_injection` (2 cases). Versus and guarantee-plus guarantees are sized from the show's net box office, so the percentage side decides about half of those payouts; otherwise a wrong percentage would still give the "exact" payout.
- **Runner:** `pnpm evals` calls the production `extractContractTerms` on every case (4 at a time). 12 fields are scored, each as `correct`, `wrong`, `missed` (contract has it, extraction returned null) or `invented` (a value the contract does not have). Payout exactness runs the extracted terms through the real engine with the case's sales and expenses.
- **Oracle:** `pnpm evals --oracle` answers with the ground truth instead of calling Claude. It must score 100%; it tests the pipeline (scoring, text ↔ cents, dataset), not the model.
- **Reports** go to `evals/reports/` (gitignored); `--save-baseline` writes `packages/evals/baselines/extraction.{json,md}` (committed). The CI gate is `.github/workflows/evals.yml` (below).
- **Baseline (2026-11-19, `claude-opus-5-5`, `extract-v2`):** 300/300 fields, 25/25 payouts exact, 0 retries, $1.05 for 25 contracts ($0.042 each), 5.8 s each. The dataset is now too easy to separate good prompts from better ones; harder templates are on the Later list.
- **CI gate (Phase 7):** `evals.yml` runs `pnpm evals --compare-baseline` on PRs that touch the extraction module, the llm client, `packages/schemas` or `packages/evals` (about $1 a run, so only those paths). `runner/compare.ts` fails the run when field accuracy or payout exactness is below `baselines/extraction.json` (rates compared by cross-multiplying, so a run on fewer cases is judged fairly); the table is posted as one PR comment, edited on each run. PRs from forks get no secrets, so the job is skipped there. The agent eval is not gated and its files do not trigger this one (the agent does not change extraction); rerun it by hand when the agent prompt or tools change (about $0.05 with Haiku).
- **Agent eval (Phase 4):** `pnpm evals:agent [--model <id>]` runs the production audit (same loop, tools, prompt, limits) on every case. The context is built from the case's ground-truth terms, so an extraction mistake cannot count against the agent; flags go to a list in memory. Scored by expense: **precision** = flagged expenses that are planted violations / all flagged expenses, **recall** = planted violations flagged / all planted, plus whether the flag kind was right. `--oracle` flags exactly the planted violations and must score 100%. Baseline: `packages/evals/baselines/agent.{json,md}`.
- **Agent baseline (2026-11-24, `claude-haiku-5-5`, `agent-v1`):** precision 100% (26/26), recall 100% (26/26), right kind 26/26, 25/25 answered; 62 model calls and 127 tool calls in all, $0.046 for 25 audits ($0.0018 each), 10.1 s each. Haiku became the default `AGENT_MODEL`. Sonnet and Opus were not run (API budget), so this says Haiku is enough for this dataset, not that it beats them; like extraction, the dataset is now too easy to separate models (harder cases are on the Later list).

---

## 12. Observability (F12)

- Structured JSON logs (pino) with `requestId` / `jobId` / `settlementId` on every line.
- `AgentRun` / `AgentStep` tables: the full replay of every agent conversation, with token cost.
- `AuditLog`: who changed what, before/after.
- Optional: Prometheus metrics (job durations, LLM latency, payout failures) with a Grafana dashboard.

As built (Phase 7, `apps/api/src/common/logging.ts`, `request-context.ts`):
- **pino**, one JSON object per line on stdout (`LOG_FORMAT=pretty` for readable text, `LOG_LEVEL` default `info`). Nest's own lines and every `new Logger(...)` go through a small `NestPinoLogger` adapter, so the existing log calls did not change.
- **Context without passing ids around:** an `AsyncLocalStorage` holds `{ requestId, jobId, settlementId, contractId }` for the current request or job; pino's `mixin` adds it to every line. `withLogContext` starts one (middleware, job handlers), `addLogContext` adds an id found halfway (the payout job and the webhook add `settlementId` after reading the payout).
- **HTTP:** module middleware sets `requestId` (the caller's `x-request-id` if it is short and plain, else a UUID), echoes it in the response header and logs one `request finished` line (method, path without query, status, duration). It is module middleware, not `app.use`, because the body parser calls `next()` from a stream event and the context would be lost. An interceptor adds the route's `:settlementId`; it runs after the auth guard, so a `401` line has only the `requestId`.
- **Jobs:** `jobId` is `queue:id` (`payouts:42`, `contract-extraction:7`). Headers and bodies are never logged (session cookies, API keys, contract text).

---

## 13. Debugging guide

A wrong payout can come from exactly four layers. Check them in order:

| # | Layer | Question | How to check |
|---|-------|----------|--------------|
| 1 | **Extraction** | Did we read the contract right? | Compare `ContractTerms` fields with their evidence quotes; re-run extraction on that PDF in the eval runner |
| 2 | **Inputs** | Were the sales/expenses right? | Diff the `inputSnapshot` against the source CSV/receipts |
| 3 | **Engine** | Given those inputs, is the math right? | Feed `inputSnapshot` into the engine locally. It's pure, so it reproduces exactly. Turn the case into a golden test |
| 4 | **Payment** | Did the right amount move, exactly once? | `Payout` row ↔ Stripe dashboard transfer ↔ `ProcessedWebhookEvent` |

Agent misbehaving? Open its `AgentRun` and read the steps. Did it call the right tool, with what input, and what did it get back? Common causes are a weak tool description, a tool returning too much or too little, or a missing `tool_result`.

**Practice:** deliberately break things (wrong rounding, a duplicate webhook, a killed worker mid-payout) and confirm the system behaves as designed. Each phase's "Break it" drill, with what to look for, is in `SELF_CHECK.md`; real bugs and their fixes are described in the PRs and in the "as built" notes of this document.

---

## 14. Build order

1. Monorepo + Docker Compose + Prisma schema + seed script
2. `settlement-engine` with full tests **(before any UI or AI)**
3. F1 import + F5 basic worksheet using manually entered terms
4. Eval generator (synthetic contracts) → F2 extraction → F3 review
5. F12 tracing → F6 agent loop
6. F7 state machine + Stripe + webhooks, F8 queues
7. F9 API → F10 MCP
8. Eval CI gate, README

**Why this order:** the engine is the foundation and the easiest thing to prove correct. The eval data generator comes before extraction, so extraction is measured from its first version. Payments come after the state machine is solid.

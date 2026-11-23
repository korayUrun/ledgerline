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
- **`ExpenseFlag`** (`expenseId`, `agentRunId`, `kind: category_not_allowed|over_category_cap|other`, `reason`, `status: open|accepted|dismissed`, `resolvedById`, `resolvedAt`). A flag is a note, not an input: it never changes the expense or makes the settlement stale. Open flags block submit-for-review, like pending expenses.

As built in Phase 5 (login):
- **`User.passwordHash`** (`scrypt$<salt>$<hash>`, Node's built-in scrypt; null = cannot log in) and **`Session`** (`userId`, `tokenHash` UNIQUE, `expiresAt`, 7 days). The token is 32 random bytes; only its SHA-256 is stored, so a leaked row cannot be used to log in. Logout deletes the row, which kills the token everywhere.
- **Every API route needs a session unless it is `@Public()`** (health, login). A global `AuthGuard` reads `Authorization: Bearer <token>`, loads the user and attaches the actor; controllers take it with `@CurrentActor()`. Closed by default: a new endpoint is protected without anyone remembering to protect it. Wrong email and wrong password give the same 401 message.
- **Web:** the login server action stores the token in an httpOnly, SameSite=Lax cookie (page JavaScript cannot read it), and every call from the Next.js server to the API sends it as the bearer token. A 401 from the API redirects to `/login`. The browser still never calls the API.

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
- The model comes from config per task: `EXTRACTION_MODEL` (default `claude-opus-5-5`) and `AGENT_MODEL` (default `claude-sonnet-5-5`, to be confirmed by the agent eval). Retries on 408/409/429/5xx and dropped connections are the SDK's own (`maxRetries`, exponential backoff, honours `Retry-After`); we configure them instead of writing a second retry loop. Timeout `LLM_TIMEOUT_MS` (120 s).
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

As built so far (Phase 5, `apps/api/src/modules/payments/`):
- **Approval** (`POST /shows/:id/settlement/approve`, logged-in person only) is one transaction: `in_review → approved` (audit `settlement.approved`), the `Payout` row (attempt 1, `pending`), `approved → paying` (audit `settlement.payment_started` with the payout id and key). It re-checks the inputs hash first; the read before it also runs the drift check, so changed data turns the settlement stale and the approval gets a 409.
- **Two approvals at once:** both read `in_review`; the compare-and-set lets one UPDATE match, the other gets a 409 and its transaction (with its Payout insert) rolls back. Tested with two concurrent requests: exactly one payout.
- **`Payout`**: one row per attempt, `idempotencyKey = payout:<settlementId>:v<version>:a<attempt>` (UNIQUE), `UNIQUE(settlementId, attempt)`, `amountCents` copied from the approved settlement. A retry (`POST …/retry-payment`, only from `payment_failed`, only after a failed payout) is a new row with a new key, because Stripe answers a repeated key with the first answer.
- Not yet: the payout job, Stripe, the webhook and the sweeper (next PRs). Until then an approved settlement stays `paying` with a `pending` payout.

---

## 9. Background jobs (F8)

| Queue | Job | Retries | Idempotent because |
|-------|-----|---------|--------------------|
| `contract-extraction` | extract terms for a contract | 3, exponential | writes a new terms version; re-running is harmless |
| `payouts` | send transfer for a payout | 5, exponential | Stripe idempotency key + status check before calling |
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

**MCP server:** a separate small process using the official SDK, with stdio transport for Claude Desktop. Each MCP tool is a thin wrapper over one `/v1` endpoint, with a clear description and an input schema.

**Why MCP → API instead of MCP → DB:** the same auth, validation, state machine and audit log apply. The MCP server has no special powers and holds no business logic.

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
- **Reports** go to `evals/reports/` (gitignored); `--save-baseline` writes `packages/evals/baselines/extraction.{json,md}` (committed). The CI gate comes in Phase 7.
- **Baseline (2026-11-19, `claude-opus-5-5`, `extract-v2`):** 300/300 fields, 25/25 payouts exact, 0 retries, $1.05 for 25 contracts ($0.042 each), 5.8 s each. The dataset is now too easy to separate good prompts from better ones; harder templates are on the Later list.
- **Agent eval (Phase 4):** `pnpm evals:agent [--model <id>]` runs the production audit (same loop, tools, prompt, limits) on every case. The context is built from the case's ground-truth terms, so an extraction mistake cannot count against the agent; flags go to a list in memory. Scored by expense: **precision** = flagged expenses that are planted violations / all flagged expenses, **recall** = planted violations flagged / all planted, plus whether the flag kind was right. `--oracle` flags exactly the planted violations and must score 100%. Baseline: `packages/evals/baselines/agent.{json,md}`.

---

## 12. Observability (F12)

- Structured JSON logs (pino) with `requestId` / `jobId` / `settlementId` on every line.
- `AgentRun` / `AgentStep` tables: the full replay of every agent conversation, with token cost.
- `AuditLog`: who changed what, before/after.
- Optional: Prometheus metrics (job durations, LLM latency, payout failures) with a Grafana dashboard.

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

**Practice:** keep a `DEBUGGING.md` log. Every time something breaks, write down the symptom, the layer, the root cause and the fix. Deliberately break things (wrong rounding, a duplicate webhook, a killed worker mid-payout) and confirm the system behaves as designed.

---

## 14. Build order

1. Monorepo + Docker Compose + Prisma schema + seed script
2. `settlement-engine` with full tests **(before any UI or AI)**
3. F1 import + F5 basic worksheet using manually entered terms
4. Eval generator (synthetic contracts) → F2 extraction → F3 review
5. F12 tracing → F6 agent loop
6. F7 state machine + Stripe + webhooks, F8 queues
7. F9 API → F10 MCP
8. Eval CI gate, README, demo

**Why this order:** the engine is the foundation and the easiest thing to prove correct. The eval data generator comes before extraction, so extraction is measured from its first version. Payments come after the state machine is solid.

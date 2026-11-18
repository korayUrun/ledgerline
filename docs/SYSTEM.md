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
- **`User`** exists from Phase 2 so that `AuditLog.actor` and `ContractTerms.confirmedBy` point to a person. Until login exists, the API acts as the seeded demo user.
- **`SettlementLine.sourceRefs` is JSON**, not foreign keys: a line describes the frozen `inputSnapshot`, and live rows may be edited or deleted later.

As built in Phase 3:
- **`Contract`** (`fileKey`, `fileName`, `status`, `extractionJson`, `promptVersion`, `llmUsage`, `failureReason`). The extraction is a *proposal* stored on the contract; it only becomes a `ContractTerms` row when a person confirms it. So every `ContractTerms` version is confirmed by a person, and compute (which reads the latest version) can never use unreviewed terms.
- **`ContractTerms.contractId`** (nullable) links a version to the contract it was confirmed from; `null` means typed in by hand. Evidence quotes stay on `Contract.extractionJson` (there is no `evidenceJson` column).
- **`llmUsage`** holds `{ model, calls, inputTokens, outputTokens, costNanoUsd }`. Cost is integer nano-dollars (1 USD = 10⁹), for the same reason money is integer cents.

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

Stale detection has two layers. (1) Every service that changes an input (ticket sales, expenses, terms) calls `markStaleIfComputed` in the same transaction. (2) Reading a settlement re-hashes the live inputs and compares with `inputsHash`, which also catches changes made around the API (manual SQL, bugs).

Pending expenses are included in the math (a preview) but block `computed → in_review` until each one is allowed or disallowed.

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
- The model comes from config (`EXTRACTION_MODEL`, default `claude-opus-5-5`). Retries on 408/409/429/5xx and dropped connections are the SDK's own (`maxRetries`, exponential backoff, honours `Retry-After`); we configure them instead of writing a second retry loop. Timeout `LLM_TIMEOUT_MS` (120 s).
- Every call logs task, model, stop reason, tokens, cost and duration. Prompt and reply text are never logged.
- Only the worker reads `ANTHROPIC_API_KEY`; the HTTP API never calls Claude. `LLM_CLIENT=fake` runs the worker without a key (every field comes back missing, so a person types the terms).

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
- The output schema is `ContractExtractionSchema`, not `ContractTermsSchema`: each field is `{ value, evidence: { quote, page } | null }`, and **amounts and percentages are copied as text** (`"$12,500.00"`, `"85%"`). Code converts them with `parseDollarsToCents` / `parsePercentToBps`, so the model does no arithmetic at all, not even ×100.
- It is sent as `output_config.format` (JSON Schema built from Zod by the SDK's `zodOutputFormat`), with adaptive thinking at effort `medium`. The PDF is a base64 `document` block.
- Zod then checks what JSON Schema cannot: a value without an evidence quote, a figure that does not parse, a percentage above 100%, a term the deal type does not use, a cap on a category that is not allowed, highest-only tiers that pay less as the threshold rises. Only these are retried (the reply and the exact issues are appended to the conversation; max 2 retries).
- **A missing required term is not retried.** Retrying would push the model to guess. It reaches the review screen as "Not found in the contract" (the "guarantee present for a versus deal" check above moved to `draftToContractTerms` and the human review).
- `stop_reason` is checked before the content: `refusal` and `max_tokens` fail at once (no retry, the same request would give the same answer). No server-side refusal fallback: the eval must measure one model.
- Prompt-injection defense: the rules live in the system prompt, which says the document is data and never instructions; the contract is only in the user turn; the model has no tools and can only answer in our schema; and nothing counts until a person confirms it. Two eval contracts contain an injection sentence.
- The prompt is versioned (`EXTRACTION_PROMPT_VERSION`, stored on the contract).

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

### 7.3 Streaming answers

The web chat calls `POST /settlements/:id/ask`. The API runs the agent loop and streams text and tool-step events to the browser over Server-Sent Events (SSE).

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

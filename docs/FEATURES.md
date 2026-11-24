# Ledgerline — Feature List

Each feature has an ID (used in `PROJECT_OVERVIEW.md` and `SYSTEM.md`), what it does, **why it exists**, and what it demonstrates.

Priority: **MVP** = must ship · **Core+** = ship if MVP is solid · **Stretch** = only if time allows.

---

## F1 — Show setup & sales import · MVP
**What:** Create venues, artists and shows. Import ticket sales from a CSV (tiers, quantity, price, fees, taxes, comps) and log show expenses with receipt files.
**Why:** A settlement is only as correct as its inputs. Every number in the final payout must trace back to a stored, versioned input row.
**Demonstrates:** Full-stack TypeScript (Next.js + NestJS + Prisma + Postgres), data modeling.

## F2 — AI contract extraction · MVP
**What:** Upload an artist deal PDF. Claude reads it and returns the deal terms as strict JSON: deal type, guarantee, percentage, expense cap, promoter profit, bonus tiers. Every field also comes with the **source quote and page** it came from. If a field isn't in the contract, the model returns `null` instead of guessing.
**Why:** The terms live in unstructured documents, and a human copying them into Excel is where most settlement errors start. The source quotes let a reviewer check each field in seconds.
**Demonstrates:** LLM structured output, schema validation, retry-on-invalid-output.

## F3 — Human review of extracted terms · MVP
**What:** A side-by-side screen with the PDF on one side and the extracted fields on the other, each with its evidence quote. The reviewer can edit, then confirm. Confirmed terms are versioned.
**Why:** Money-moving code needs a human checkpoint between "AI read it" and "we pay based on it". Versioning means we always know which terms a settlement used.
**Demonstrates:** Product sense, speed balanced with care.

## F4 — Deterministic settlement engine · MVP
**What:** A pure TypeScript package that takes confirmed terms + sales + expenses and returns the artist payout as itemized lines. Supported deals: flat guarantee, percentage of net, guarantee *versus* percentage, guarantee *plus* split, plus bonus tiers and an expense cap.
**Why:** The LLM never does the math. Money calculations must be reproducible, testable and explainable line by line. Integer cents only, with explicit rounding rules.
**Demonstrates:** Correctness-critical code, testing (unit + property-based).

## F5 — Settlement worksheet · MVP
**What:** A UI that shows every line of the settlement: gross box office, taxes and fees, net, expenses, split point, overage, bonuses, final payout. Each line links to the contract clause and the input rows it came from.
**Why:** Venue managers and artists' agents argue over settlements. A worksheet where every number has provenance ends the argument. It's also our main debugging tool.
**Demonstrates:** Full-stack UI, explainability.

## F6 — Settlement audit agent · MVP
**What:** A tool-calling agent that reviews a computed settlement. It flags expenses that aren't allowed by the contract or exceed the cap, notices missing data, and answers questions like *"Why are we paying the artist $4,200?"* by calling tools, never by doing math itself.
**Why:** This is the "AI agent" part of the role. The agent adds value through judgment (is this expense allowed?) and explanation, while the engine stays the source of truth for numbers.
**Demonstrates:** Agents, tool calling, an agent loop written by hand (no framework).

## F7 — Approval & payout · MVP
**What:** A settlement moves `computed → in_review → approved → paying → paid`. Only a human can approve. The payout is sent with **Stripe Connect (test mode)** to the artist's connected account, using an idempotency key so it can never be paid twice. Status is confirmed by Stripe webhooks.
**Why:** This is the real end of the workflow. Retries, duplicate webhooks and crashes in the middle of a payment are the classic payment bugs, and the design handles each one explicitly.
**Demonstrates:** Payment flows with Stripe, state machines, idempotency.

## F8 — Background jobs · MVP
**What:** Contract extraction and payouts run as BullMQ jobs on Redis, with retries and backoff.
**Why:** LLM calls take seconds and can fail, and Stripe calls must survive restarts. Neither should block an HTTP request.
**Demonstrates:** Background job queues.

## F9 — Public REST API · Core+
**What:** A versioned `/v1` API with hashed API keys and an OpenAPI spec, covering shows, settlements and explanations.
**Why:** Customers integrate with finance tools. It's also the layer the MCP server builds on, so there is only one place where business rules live.
**Demonstrates:** API design, extending a public API.

## F10 — MCP server · Core+
**What:** An MCP server exposing tools like `list_shows`, `get_settlement`, `explain_settlement_line` and `flag_expense`. A venue manager can connect it to Claude Desktop and ask *"Show me last night's settlement"*. The MCP server has no payout tool.
**Why:** Customers want to bring their own AI tools to their data. Read-mostly tools and no payment ability keep it safe.
**Demonstrates:** MCP.

## F11 — Evals & CI · MVP
**What:** 20–30 synthetic contracts generated from a known ground truth, plus scenarios with planted bad expenses. The eval runner measures:
1. field-level extraction accuracy,
2. end-to-end payout exactness (to the cent),
3. agent flagging precision and recall.

It runs in GitHub Actions on PRs that change prompts or schemas, and fails if accuracy drops.
**Why:** "It looked right when I tried it" is not a measurement. Evals let every release prove it didn't get worse.
**Demonstrates:** Measuring model accuracy with evals, release by release.

## F12 — Audit log & agent traces · MVP
**What:** Every state change, approval and payout is written to an audit log. Every agent run stores each step: the model's tool calls, the tool results, token usage and cost.
**Why:** When something is wrong, you need to replay exactly what happened. This is the foundation of debugging.
**Demonstrates:** Ownership, operability.

---

## Stretch

| ID | Feature | Why |
|----|---------|-----|
| S1 | **Expo app** for snapping expense receipts on show night | Receipts are on paper, on show night, far from a desk |
| S2 | Port the hand-written agent loop to the **Vercel AI SDK** and compare | Learn what a framework hides by comparing it with the hand-written loop |
| S3 | Merch settlement (venue commission on soft goods) | Real settlements include it |
| S4 | Streaming chat UI over settlements | A better UX for F6 |
| S5 | Multi-currency | Touring artists |

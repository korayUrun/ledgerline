# Ledgerline — AI Show Settlement

> Turn an artist contract, ticket sales and show expenses into a correct, explainable artist payout, then pay it.

## 1. The problem

After every concert the venue (or promoter) and the artist "settle the show": they work out how much the artist is owed. The math depends on the deal in the artist's contract, for example:

- **Flat guarantee:** the artist gets a fixed fee.
- **Percentage deal (door deal):** the artist gets X% of net box office.
- **Versus deal:** the artist gets the guarantee *or* X% of net after expenses, whichever is higher.
- **Guarantee plus:** the artist gets the guarantee, plus a share of everything above a "split point" (expenses + guarantee + promoter profit).
- Plus **bonus tiers** (e.g., +$500 if 1,000 tickets are sold) and **expense caps**.

Today this is typically done in a spreadsheet, late at night, by someone copying numbers out of a PDF contract. Common failures:
- a term is misread from the contract,
- an expense that the contract doesn't allow gets deducted,
- the formula is wrong for this deal type,
- the same payment is sent twice, or not at all.

> The deal models in this project are deliberately simplified versions of real live-music settlements. Real deals have more edge cases; the engine is designed to add them one at a time.

## 2. The solution

Ledgerline splits the job into steps, and gives each step to whoever is best at it:

| Step | Who does it | Why |
|------|-------------|-----|
| Read the contract | **LLM** (structured output) | Reading messy documents is what LLMs are good at |
| Check what was read | **Human** | A mistake here costs real money |
| Do the math | **Deterministic code** | Math must be exact, reproducible and testable. LLMs are none of these |
| Review & explain | **LLM agent** (tool calling) | Judging whether an expense is allowed, and explaining the result in plain language |
| Approve | **Human** | Only a person can authorize moving money |
| Pay | **Stripe**, via an idempotent job | Retries are safe and the same settlement is never paid twice |

**Core principle:** *the AI reads and explains, the code calculates, the human approves.*

## 3. Who uses it

- **Venue / promoter settlement manager:** uploads the contract, reviews it, runs the settlement, approves the payout.
- **Artist's tour manager / agent:** reads the worksheet and asks "why is this number what it is?"
- **Developers / other AI tools:** use the public API or the MCP server.

## 4. Features at a glance

See [`FEATURES.md`](./FEATURES.md) for details.

| ID | Feature | Priority |
|----|---------|----------|
| F1 | Show setup & sales import | MVP |
| F2 | AI contract extraction (with evidence quotes) | MVP |
| F3 | Human review of extracted terms | MVP |
| F4 | Deterministic settlement engine | MVP |
| F5 | Settlement worksheet with provenance | MVP |
| F6 | Settlement audit agent (tool calling) | MVP |
| F7 | Approval & Stripe payout | MVP |
| F8 | Background jobs (BullMQ) | MVP |
| F9 | Public REST API | Core+ |
| F10 | MCP server | Core+ |
| F11 | Evals & CI | MVP |
| F12 | Audit log & agent traces | MVP |

## 5. End-to-end walkthrough

1. The manager creates a show and imports the ticket sales CSV and expenses **(F1)**.
2. They upload the artist contract PDF. A background job asks Claude to extract the terms **(F2, F8)**.
3. They check each field against its highlighted quote and confirm **(F3)**.
4. The engine computes the settlement as itemized lines **(F4)** and shows it in the worksheet **(F5)**.
5. The audit agent reviews it. Say it flags: *"Catering $1,350 exceeds the $1,000 catering cap in §4.2."* **(F6)**
6. The manager resolves the flag, recomputes, and approves **(F7)**.
7. A payout job sends the money with Stripe Connect. A webhook confirms it, and the settlement becomes `paid` **(F7, F8)**.
8. Later, someone asks in Claude Desktop via MCP: *"Why did we pay $4,200?"*. They get a line-by-line answer **(F10)**.
9. Every PR that changes a prompt runs the evals, so we know extraction didn't get worse **(F11)**.

## 6. Why each part exists (design rationale)

- **Why not let the LLM calculate the payout?** LLM arithmetic is not reliable or reproducible, and you can't unit-test a prompt the way you test a function. The engine is a pure function: same inputs, same output, every time.
- **Why evidence quotes in extraction?** They turn review from "re-read the whole contract" into "check this quote matches this number". They also make extraction errors easy to diagnose.
- **Why a human approval step?** It's a cheap safeguard against the most expensive error, a wrong payment.
- **Why integer cents?** Floating point can't represent 0.1 exactly, and rounding errors in money compound across lines.
- **Why idempotency keys and webhooks?** A network timeout doesn't tell you whether Stripe processed the request. Idempotency makes the retry safe, and the webhook is the source of truth for the final status.
- **Why background jobs?** LLM calls and payments are slow and fail now and then. A queue gives retries and keeps requests fast.
- **Why an MCP server on top of the API, not the database?** Everything goes through the same validation, permissions and audit log. There is one place where the rules live.
- **Why evals?** Prompts and models change. Without a fixed test set with known answers, every change is a guess.
- **Why store snapshots and traces?** Any settlement can be recomputed exactly, and any agent answer can be replayed step by step. When something breaks, you can find *which layer* broke.

## 7. Scope

**In scope (MVP):** one currency (USD), one venue organization, the four deal types plus bonuses and expense caps, synthetic data, Stripe test mode.

**Out of scope:** real banking, tax withholding for foreign artists, multi-tenant auth, merch settlement (stretch S3), production deployment hardening.

## 8. Roadmap

| Week | Goal | Done when |
|------|------|-----------|
| 1 | Foundations + engine | Monorepo running in Docker Compose; Prisma schema; F1; F4 with full unit + property tests |
| 2 | AI layer | F2 + F3 working end to end; first eval set and runner (F11) |
| 3 | Agent + payments | F6 hand-written agent loop with traces (F12); F7 Stripe Connect payout with webhooks; F8 |
| 4 | Surface + polish | F5 worksheet; F9 API; F10 MCP server; eval CI gate; README with an architecture diagram, eval results and a 2-minute demo video |

## 9. What "done" looks like

- A recorded demo: upload contract → review → compute → agent flags an expense → approve → paid.
- Eval report in the README: extraction accuracy per field, payout exactness, agent flag precision/recall.
- I can explain any line of code, and for any wrong payout I can say in which layer it went wrong: extraction, inputs, engine or payment (see the debugging guide in `SYSTEM.md`).

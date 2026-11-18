# Self-check questions

The "explain it" questions from the end of each task, collected for a review at the
end of the project. Answer out loud first, then open the answer to check yourself.
(The phase-level "Explain it" questions live in `PHASES.md`.)

## Phase 2 — Data model, core API & basic UI

**1. If someone changes an expense directly with SQL, skipping the API, how does the system notice?**

<details><summary>Answer</summary>

The services that change expenses mark the settlement stale themselves (layer 1), but
direct SQL never calls them. Layer 2 catches it: every time a settlement is read, the
live rows are hashed again and compared with the `inputsHash` stored at compute time.
If even one cent changed, the hash is completely different, so the settlement moves to
`stale` with `actor: system`.

Code: `detectInputDrift` in `apps/api/src/modules/settlements/settlements.service.ts`;
test: "layer 2 (Phase 2 'Break it')" in `apps/api/test/settlements.test.ts`.

</details>

**2. What happens if two compute requests arrive at the same moment?**

<details><summary>Answer</summary>

Both read the settlement at, say, version 1. The save is a compare-and-set:
`UPDATE … WHERE version = 1`. The first request sets the version to 2; the second
request's condition no longer matches, 0 rows are updated, and it gets a 409. Nobody's
result is silently overwritten. Because it is all one transaction, the losing request
writes no audit row either.

Code: `transition()` in `apps/api/src/modules/settlements/settlement-state-machine.ts`;
test: "never loses a compute" in `apps/api/test/settlements.test.ts`.

</details>

## Phase 3 — Eval data + contract extraction + review

**1. Why does Claude copy the guarantee as the text "$12,500.00" instead of returning 1250000 cents?**

<details><summary>Answer</summary>

Because the model must not do arithmetic that ends up in a payout, and turning dollars
into cents is arithmetic (×100, dropping commas, handling cents). A model can get that
wrong silently: 125000 instead of 1250000 still looks like a valid number. So the model
only copies what is printed, and code converts it with `parseDollarsToCents`, the same
helper the web forms use. A copied figure can also be checked against its evidence quote
by eye, and a figure that does not parse ("ten thousand dollars") is a clear validation
error that goes back to the model on a retry.

Code: `moneyTextToCents` in `packages/schemas/src/contract-extraction.ts`; test:
"text → cents / bps" in `contract-extraction.test.ts`.

</details>

**2. The worker retries a network error (BullMQ job retry) but not an extraction that failed validation. Why the difference?**

<details><summary>Answer</summary>

A validation failure has already been retried inside the extractor: twice, with the exact
errors appended. Running the whole job again would pay for the same three calls and most
likely get the same answer, so it is final: the contract goes to `failed` and the user
uploads again or types the terms in. A network error or a database hiccup is temporary,
so the job is rethrown and BullMQ tries again later (5 s, 10 s). On the last attempt the
worker marks the contract `failed` first, so it never stays in `extracting` forever. Every
run starts by re-reading the contract and exits if the work is done, so a retry can never
extract (and bill) twice.

Code: `ExtractionProcessor.process` in
`apps/api/src/modules/contracts/extraction/extraction-processor.ts`; tests: "marks the
contract failed when Claude's answer stays invalid…" and "lets BullMQ retry an unexpected
error…" in `apps/api/test/contracts.test.ts`.

</details>

---

# Deferred phase quizzes (after the last phase)

The phase-level "Explain it" questions from `PHASES.md` that were moved to the end of
the project. Answer them out loud before the final review.

## Phase 2 — Data model, core API & basic UI

**1. Why store `inputSnapshot` when the data is already in other tables?**

<details><summary>Answer</summary>

The other tables hold the *current* data, and it keeps changing: expenses get edited,
a new CSV replaces the ticket sales, terms get a new version. The snapshot is a frozen
copy of exactly what the engine saw at compute time. That gives three things:
- the worksheet always explains the numbers that were actually computed, even after the inputs change;
- the result can be recomputed bit-for-bit later (same input + same `engineVersion` → same payout);
- its hash (`inputsHash`) is what lets us notice that the live data has drifted, even
  when someone changes a row directly in the database.

In Phase 5 the payout will be based on the approved snapshot, not on whatever the
tables say at payment time.

</details>

**2. What happens if two requests compute the same settlement at the same moment?**

<details><summary>Answer</summary>

Both read the settlement at version N. Each saves with a compare-and-set:
`UPDATE … WHERE id = ? AND status = ? AND version = N`. The first sets version N + 1.
The second matches 0 rows and gets a 409, so no result is silently overwritten (no
"lost update"). If the settlement does not exist yet, the unique index on `showId`
lets only one `create` win; the loser catches P2002 and uses the winner's row.

Code: `transition()` in `settlement-state-machine.ts`, `findOrCreateDraft()` in
`settlements.service.ts`. Test: "never loses a compute" (5 parallel computes:
final version = 1 + number of successes).

</details>

**3. Why must the audit log write be in the same transaction as the status change?**

<details><summary>Answer</summary>

So the two are written together or not at all. In separate steps, a crash or error in
between leaves either a status change with no record of who did it, or an audit row
claiming something that never happened. Both break the point of an audit log, which
is to be a trustworthy history for debugging and disputes. In one transaction, if
either write fails, Postgres rolls both back.

Test: "refuses a transition based on an outdated read, and writes no audit row for it".

</details>

**Break it (Phase 2):** change an expense amount directly in the DB after compute.
Does the system notice? How? Covered by the automated test "layer 2 (Phase 2 'Break
it')" in `apps/api/test/settlements.test.ts`; do it by hand once at the end
(`psql`, then reload the worksheet).

## Phase 3 — Eval data + contract extraction + review

**1. What does the JSON Schema guarantee, and what does Zod still need to check?**

<details><summary>Answer</summary>

With structured output (`output_config.format`) the API guarantees the *shape*: valid
JSON, every required key present, the right types, enum values from the list, `null` only
where allowed, no extra keys. It does not check:
- numeric ranges (`minimum`/`maximum` are not supported; the SDK moves them into the field
  descriptions),
- rules across fields: a value must have an evidence quote, a term must fit the deal type
  (no guarantee on a percentage deal), a cap must be on an allowed category, highest-only
  tiers must not pay less as the threshold rises,
- whether a copied figure like "$12,500.00" can be read as money at all.

Zod checks all of that after the reply, and the shape again, because LLM output is
untrusted: a `refusal` or `max_tokens` reply may not follow the schema at all. The same
Zod schema produces the JSON Schema we send, so the two cannot drift apart.

Code: `ContractExtractionSchema` in `packages/schemas/src/contract-extraction.ts`;
`extract-contract.ts` for the parse-and-retry loop.

</details>

**2. Why return `null` with no evidence instead of the model's best guess?**

<details><summary>Answer</summary>

A guess looks exactly like a real value, so the reviewer may accept it, and a wrong
guarantee or cap becomes a wrong payment. `null` is visible: the review screen shows "Not
found in the contract" and the person reads the PDF and fills it in. Every value must
come with the words it came from; a guess has no such quote. The costs are uneven: a
missing field costs a minute of typing, an invented one can cost real money and trust.
That is also why the extractor does not retry when a required term is missing: asking
again would push the model to invent one. The eval counts "invented" separately from
"wrong" and "missed" for the same reason.

</details>

**3. Why generate the PDFs from JSON instead of labeling real contracts by hand?**

<details><summary>Answer</summary>

- The labels are correct by construction: the terms come first and the text is written
  from them, so nobody can mislabel a field.
- Hard cases are added on purpose and named (deposit next to the guarantee, a merchandise
  percentage, money in words, sub-clauses, missing total cap, prompt injection), so the
  report can say which kind of contract breaks the model.
- The expected payout comes from the engine, which gives an end-to-end metric: payout
  correct to the cent, not only fields correct.
- Seeds make it reproducible, and no real contracts are needed (out of scope and private).

The limit: templates are tidier than real contracts, so these scores are optimistic. The
fix is harder templates over time, not fewer evals.

</details>

**4. Why does extraction run in a worker and not in the HTTP request?**

<details><summary>Answer</summary>

It takes seconds to tens of seconds and can fail or need retries. Inside a request, the
browser waits (and may give up and click again, paying twice), proxies may time out, and
an API restart kills the work halfway. In a worker the request returns at once with
`uploaded`, the page polls the status, and BullMQ adds retries with backoff, recovery of
jobs whose worker crashed, and de-duplication (`jobId = contractId`). The worker also
fails and scales on its own: a slow Claude call never blocks other HTTP requests.

</details>

**Break it (Phase 3):** remove the "If a term is not stated, set both value and evidence to
null. Never infer…" rule from `extraction-prompt.ts`, bump `EXTRACTION_PROMPT_VERSION`,
run `pnpm evals`, and compare the per-field table with `packages/evals/baselines/extraction.md`.

<details><summary>What to look for</summary>

Watch the **Invented** column and the tags. The likely places: `expensePolicy.totalCapCents`
on `no_total_cap` contracts (a deposit or cancellation fee taken as a cap),
`deal.guaranteeCents` taken from the deposit (`deposit_distractor`), a bonus on contracts
with no bonus clause, a promoter profit on versus deals. Some inventions are still stopped
by the Zod refinements (a guarantee on a percentage deal contradicts the deal type and is
sent back for a retry); an invented total cap is not, because it is a plausible value, and
only the human review would catch it. That is the point of the drill: the prompt rule and
the human review are both defenses; Zod alone is not enough. Restore the prompt afterwards.
Needs a live run (API key).

</details>

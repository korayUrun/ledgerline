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

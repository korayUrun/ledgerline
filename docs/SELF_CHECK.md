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

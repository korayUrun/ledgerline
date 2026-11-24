# Agent eval: expense flags

2026-11-24T08:17:08.905Z · live · `claude-haiku-5-5` · prompt `agent-v1`

| Metric | Value |
|---|---|
| Precision (flagged expenses that are planted violations) | 100.0% (26/26) |
| Recall (planted violations flagged) | 100.0% (26/26) |
| Right kind (of the found) | 100.0% (26/26) |
| Outcomes | answered 25 |
| Model calls / tool calls | 62 / 127 |
| Tokens in / out | 255,112 / 40,753 |
| Cost | $0.0459 |
| Average time per case | 10.1 s |

## Cases

| Case | Deal | Outcome | Found | Missed | Wrong flags | Calls |
|---|---|---|---|---|---|---|
| c01 | flat | answered | — | — | — | 2 |
| c02 | percentage | answered | — | — | — | 2 |
| c03 | versus | answered | ex-5, ex-4 | — | — | 3 |
| c04 | guarantee_plus | answered | ex-5 | — | — | 3 |
| c05 | flat | answered | — | — | — | 2 |
| c06 | percentage | answered | — | — | — | 2 |
| c07 | versus | answered | ex-7, ex-3, ex-5 | — | — | 3 |
| c08 | guarantee_plus | answered | ex-7 | — | — | 3 |
| c09 | flat | answered | — | — | — | 2 |
| c10 | percentage | answered | — | — | — | 2 |
| c11 | versus | answered | ex-4, ex-3 | — | — | 3 |
| c12 | guarantee_plus | answered | ex-4, ex-1, ex-2 | — | — | 3 |
| c13 | flat | answered | — | — | — | 2 |
| c14 | percentage | answered | — | — | — | 2 |
| c15 | versus | answered | ex-7, ex-2, ex-3 | — | — | 3 |
| c16 | guarantee_plus | answered | ex-4, ex-2 | — | — | 3 |
| c17 | flat | answered | — | — | — | 2 |
| c18 | percentage | answered | — | — | — | 2 |
| c19 | versus | answered | ex-7, ex-3 | — | — | 3 |
| c20 | guarantee_plus | answered | ex-4, ex-3 | — | — | 3 |
| c21 | flat | answered | — | — | — | 2 |
| c22 | percentage | answered | — | — | — | 2 |
| c23 | versus | answered | ex-7, ex-1, ex-4 | — | — | 3 |
| c24 | guarantee_plus | answered | ex-7, ex-4 | — | — | 3 |
| c25 | flat | answered | — | — | — | 2 |

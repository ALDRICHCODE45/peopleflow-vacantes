# Screening v2 — U1b1 PATCH isolation
Continue authorized isolation before codec; preserve closed U1a GET behavior.
No commits, push, cleanup, replay changes or v2 exposure.

## Specs
S1. "ADelante con lo que sigue, no hay que detenernos"
S2. "Allowed edits exactly backend/internal/features/jobs/infrastructure/postgres/draftstore/store.go (Save only), README.md (PATCH boundary), backend/cmd/api/draft_flow_integration_test.go (PATCH cases); schema.go unchanged dependency; preserve U1a GET/tests and unrelated staged/index state."
S3. "Adopt your auth->schema->IfMatch->body matrix incl full no-write snapshots, existing v1 regressions; RED/GREEN, own checks, independent verifier."
S4. "Accept standalone same-clone review under your root based exact08485882c2bade60edc5a2ad98ae76a07a638090 containing ONLY U1b1 hunks + byte-identical37line schema dependency. Disclose reviewed prerequisite overlap; no synthetic commits/cumulative GET review."
S5. "Verify projected candidate has same PATCH behavior and test prerequisites; stop if dependencies require expansion. Native consent separate; no commits/push/reset/cleanup. Existing testDB authorized."
S6. "U1b2 stays pending technical reconciliation, do not alter cached body/rerender or precedence."

## Tasks
- T1 [done] S1-S3,S5-S6 — bounded worker: public HTTP RED, Save-only schema gate, PATCH docs, GREEN and regressions; commit prohibited.
- T2 [done] S1-S6 — independent verification, isolated U1b1 native review, evidence and closure; commit prohibited.

## Log
L1. User exact authorization relayed by frontend: "ADelante con lo que sigue, no hay que detenernos".
L2. FE seq9 accepts PATCH ONLY and exact S2-S6 above. Test target remains new authorized container peopleflow-screening-u1a-01a11bd8 / 127.0.0.1:55438 / draft_test. Never ambient DATABASE_URL.
L3. Test matrix: schema1 existing save/noop/CAS/validation unchanged; authorized schema2=>404 despite missing/malformed/stale IfMatch or malformed body; missing/unknown/corrupt schema=>500 after auth; nonprincipal/cross-org=>404 even corrupt. Rejects no ETag/editor data, Cache-Control no-store, unchanged complete draft/audit/idempotency snapshots. Use existing real HTTP JWT harness. No new routes or codec.
L4. U1a source dependency schema.go stays byte-identical, and GET4line guard/GET tests remain untouched. Native standalone candidate will exclude those U1a GET hunks and include unchanged schema dependency explicitly; no synthetic commit. Base08485882c2bade60edc5a2ad98ae76a07a638090. Original requesterName staged115+333 and OpenSpec untouched.
L5. Worker muzuag9o-4-wgch reports RED13 authorized failures before Save edit; focused GREEN, all TestDraftFlow_ HTTP tests exit0 (0.908s), store package tests exit0, gofmt/diffcheck clean. Mistaken literal trailing dot in one store command tried nonexistent backend root package and failed; corrected package target passed. No race/full suite/store-tagged run. Parent read Save diff and complete PATCH test; schema dependency actually35lines (earlier37 estimate corrected).
L6. Created registered .scratch/screening-v2-patch-isolation-review from08485882c2bade60edc5a2ad98ae76a07a638090, only Save8lines+PATCHtest154lines+PATCHREADME plus unchanged schema.go SHA2569bfa0aecfc075565508847663d7def19e04946575491422e1cab1e53eedaf9ec. Original GET/test excluded; integrated original preserved. Original index byte-identical before/after. Projection README extra EOF blank detected/fixed before review; no runtime changes. Isolated HTTP regression+store package probe passed exit0 (0.649s/0.004s).
L7. Independent muzujfel-5-zkx5 S1-S6 PASS; isolated PATCH probe reported0.519s, no material blockers; projection behavior/prerequisites verified against original. Reported command includes a trailing dot despite PASS; parent independently observed exact package commands pass. No independent index-baseline claim.
L8. Native review-a0907e22b502f658 isolated candidate859e695fd7143859291107ad421a4835df548a27 targetsha256:1d54ab074dc45652d414c523076f8aaa8b5722af4461a8ddf1d2dcb60d9371f8 medium/review-reliability. First reviewer submission rejected for inconsistent inspection evidence, slot unconsumed. Fresh bound STATUS reoffered same slot; new capture approved, exact acknowledgement completed authorityburned consumed_revision sha256:310d02ae86c3ca47b6d7a736184bd748b6aeb14b5af6913a083db2df759bc598. No source corrections, commits, push, resets or cleanup. U1b1 closed; U1b2 requires separate read-only technical reconciliation.

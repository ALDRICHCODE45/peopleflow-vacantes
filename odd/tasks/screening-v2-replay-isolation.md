# Screening v2 — U1b2 current-row replay isolation
Preserve completed GET/PATCH units and frozen v1 response semantics.
No commits, push, cleanup, cached-envelope policy or v2 exposure.

## Specs
S1. "ADelante con lo que sigue, no hay que detenernos"
S2. "Allowed edits: backend/internal/features/jobs/infrastructure/postgres/draftstore/store.go (authorizeAddressedDraft only), same-directory README.md (replay boundary only), backend/cmd/api/draft_flow_integration_test.go (standalone replay tests). schema.go reused byte-identical; GET/PATCH/tests preserved."
S3. "Gate currentrow after authorized before fingerprint/replay: known2=>404; missing/unknown/corrupt=>500 afterauth; unauthorized404; no mutation."
S4. "Preserve key/general/DecodeCreate/locklookup/r1tag precedence, operation create, frozenbody+ETag replay byte-exact incl olderCAS; never parse/rerender/migrate existing.body."
S5. "Test requested cases, changed-fingerprint precedence and previous valid replay semantics via publicHTTP; RED/GREEN, own checks then independent. Existing testDB authorized."
S6. "Prepare registered standalone same-clone review under your root from08485882c2bade60edc5a2ad98ae76a07a638090 with ONLY replay hunks+unchanged schema prerequisite, disclose overlap and prove isolated behavior; no cumulative GET/PATCH candidate. Native consent separate, no commits/push/cleanup/reset."

## Tasks
- T1 [done] S1-S5 — bounded worker: public HTTP RED, current-row gate, replay-only docs, GREEN/regressions; commit prohibited.
- T2 [done] S1-S6 — independent verification, isolated native review and closure; commit prohibited.

## Log
L1. User exact authorization relayed by frontend: "ADelante con lo que sigue, no hay que detenernos".
L2. FE seq10 accepts current-row-only replay isolation under v1 sections6.1/6.3/9.4. Cached response corruption policy is explicitly separate, not silently implemented. Existing accepted schema guard reused35lines unchanged.
L3. Authorized test target: peopleflow-screening-u1a-01a11bd8 container, postgres://postgres@127.0.0.1:55438/draft_test?sslmode=disable. Never ambient DATABASE_URL. Harness owns randomized fixture creation/cleanup, no container/database cleanup.
L4. Base08485882c2bade60edc5a2ad98ae76a07a638090; original has U1aGET/U1b1PATCH uncommitted but independently/native approved. Preserve them and staged requesterName/OpenSpec. Future isolated review includes only new replay hunks plus unchanged schema dependency, disclosing prerequisite overlap. Reject cases assert no-store/noETag/error-only and complete draft/audit/idempotency snapshots. Existing schema1 frozen replay remains201 even after current row CAS increment.
L5. Initial worker muzuqulh-6-lh5o report rejected by parent readback: missing schema2test, authcase not corrupt, invalid read-envelope fixture restored as canonical. Correction muzv1m10-7-114y fixed coverage: schema2 same/changed404; six corruptmarkers same/changed500; authbeforecorrupt404; valid schema1conflict409, badbody400 precedence, real canonical restore and olderCAS frozen replay noWrites. Earlier unauthorized RED409 was an interim invalid fixture, not baseline bug; worker corrected evidence. Additional RED by temporarily disabling/restoring one gate observed true201/409 vs404/500. Final focusedReplay0.312s/allHTTP1.082s/store0.004s PASS. No Create/Get/Save source edits.
L6. Created/registered .scratch/screening-v2-replay-isolation-review base08485882c2bade60edc5a2ad98ae76a07a638090; isolated ONLY helper replayhunk+312line standalone tests+35line replayREADME and unchanged35line schema dependency SHA2569bfa0aecfc075565508847663d7def19e04946575491422e1cab1e53eedaf9ec. GET/PATCH hunks omitted; extraction exact, original index/workdiff byte-identical before/after preparation. diffcheckPASS. Parent isolated HTTP/store probes PASS0.747s/0.004s. Independent muzvae4v-8-46jh S1-S6PASS no materialblockers, exact focusedReplay probe exit0 0.309s; helper/tests/docs parity and prerequisite overlap verified.
L7. Isolated native review-ea5a8758b72dfb30 approved without correction; exact acknowledgement completed, authorityburned consumed_revision sha256:aa6836d02c0cacfb10abb3d3c54af9a43ee8e336caa28f2e6390cbdc2e23328f, targetsha256:42ffc62fa17012818139874e6bf34544f33c6b0f428c3521caa309a1762dfe45, candidatecc4fc768a9fa8a8fc0d3cecf4ef42603f8b3ed3e. No commits/push/reset/cleanup/v2enablement. T1/T2 complete. GET/PATCH/currentrow replay isolation complete; next prerequisite is explicit v2 store/read/ETag/namespace design wiring before typed codec/exposure, not cached-envelope corruption policy.

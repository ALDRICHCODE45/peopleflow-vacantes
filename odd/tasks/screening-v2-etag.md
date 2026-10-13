# Screening v2 — U2a pure r2 ETag primitives
Additive formatter/parser only; v1 and all store/HTTP wiring remain unchanged.
No DB, endpoints, commits, push or cleanup.

## Specs
S1. "ADelante con lo que sigue, no hay que detenernos"
S2. "only backend/internal/features/jobs/application/draftversion/etag_v2.go, etag_v2_test.go, README.md. FormatETagV2/ParseIfMatchV2 additive, existing Tag/sentinels/Compare/private lexical helpers reused read-only; etag.go/oldtests/store/HTTP unchanged."
S3. "missing-API compile failure is NOT behavioral RED. Use compilable minimal skeleton then observe actual requested r2 behavior failures before implementation; report compile failures separately."
S4. "Cover exact quotedr2, missing vs presentempty, weak/list/star/unquoted/r1 rejection, resource lowercaseUUID36/int64 bounds and lexical cases, SPHTAB parity, Compare mismatch/stale, explicit r1 regression using newtest file. Pure public API checks, no DB needed."
S5. "Own focused/package/full applicable checks, then native ASSESS plan; independent verification as returned/highrisk, not reflex review for medium unless explicitly needed. No unused adapter/operation constants, no endpoint/readiness claim."
S6. "Standalone sameclone worktree under backendroot allowed only these3paths based08485882, no U1 overlap; consent separate, no commits/push/cleanup."

## Tasks
- T1 [done] S1-S5 — bounded worker: behavioral RED, additive r2 primitives and docs, GREEN and package/full checks; commit prohibited.
- T2 [done] S1-S6 — parent spot check, native assessment and required verification/closure; commit prohibited.

## Log
L1. User exact authorization relayed by frontend: "ADelante con lo que sigue, no hay que detenernos".
L2. FEseq12 accepted pure U2a only. Public signatures FormatETagV2(id string,version int64)(string,error), ParseIfMatchV2(value string,present bool)(Tag,error). Quoted jd-r2-lowercaseUUID36-vpositiveint64, separate marker parser. Existing sentinels reused; Compare remains scheme-neutral. No authoring UUIDv4 restriction imposed on resource ID; preserve v1 lexical policy.
L3. Base08485882c2bade60edc5a2ad98ae76a07a638090. Existing U1 GET/PATCH/replay source+tracking+native authorities and staged requesterName/OpenSpec preserved. No DB required. No selector/store/read/operation scaffolding until next scoped unit.
L4. Worker muzvllfn-b-ugvj observed compilable skeleton behavioralRED42fail entries (zero compileerrors), then focused/package/full go test./... PASS. Parent read implementation, verified oldetag.go/etag_test.go byte-identical toHEAD. Created registered .scratch/screening-v2-etag-review from exactbase, copied only3files byte-identically and staged only its isolated index to permit nativeassessment; originalindex/workdiff byte-identical before/after, no commit.
L5. NativeASSESS isolatedcandidate medium3paths336lines, reviewDue:false reasonunder_budget; writerprofilefallbacksmall requires independentVerifier. No nativeSTART required or performed. Parent isolatedpackageprobe PASS0.003s. No DB/service access.
L6. Independent muzvslbb-c-k5uu: no material blockers; pure package probe PASS0.004s. S4 coverage verified; advisory only: no explicit r2 nil/non-v4 acceptance case, shared unchanged lexical helper permits both. Historical RED/fullsuite remain worker evidence, parity/base/index remain parent evidence. No automatic advisory expansion. ASSESS reviewDuefalse: no native review started, no approval claimed. U2a complete; store/read adapter requires next bounded scope. No commits/push/cleanup.

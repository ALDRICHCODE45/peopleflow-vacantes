# Org candidates API — «Candidatos de mi organización» v1 (DRAFT)

Status: **contract approved; list accepted; detail/CV awaiting parent DB acceptance**.
The list, detail and participation-CV routes are wired. Feature document:
`odd/tasks/org-candidates.md`. Business rules: SRCH-2/3/4/7 in
`docs/recruitment-business-rules.md` §12.

## Scope and access

- Routes: `GET /v2/me/company/candidates` (list) and
  `GET /v2/me/company/candidates/{kind}/{id}` (detail), plus
  `GET /v2/me/company/candidates/{kind}/{id}/participations/{participationId}/cv`.
- Gates: `NoStore → RequireAuth → requireRecruiter`. **Every recruiter of the
  company sees the whole pool** (user decision); no owner-or-principal check,
  unlike the board. Another company's candidate, or an unknown one, is 404.
- Pool = union of:
  - **manual** — every `company_candidates` record of the company;
  - **organic** — every user with at least one participation in a vacancy process
    of the company, whatever its source (organic application or manual reuse),
    stage or discard state, with or without a candidate profile row.
- Identity is `(kind, id)`: `kind` is `manual` (id = company candidate UUID) or
  `organic` (id = user UUID). The same real person may appear once per kind;
  v1 never merges them (duplicates stay advisory, as in manual intake).
- Nothing here leaves the company (SRCH-7). Read-only: no edits in v1
  (audited internal edits are cut 2, SRCH-4).

## Profile source

The six-key `profile` is the board's exact shape
([board-filter-data.md](board-filter-data.md)).

- manual → read live from the company record (as the board does);
- organic → the **frozen snapshot of the candidate's most recent participation
  in this company** (latest `applied_at`, then participation id). The live
  candidate profile is never read, so the pool only shows what the candidate
  shared with this company when applying (or what the recruiter captured on reuse).

## List

`GET /v2/me/company/candidates?<filters>&limit=20&cursor=…`

```json
{"items":[{
   "kind":"organic","id":"3f0c…",
   "full_name":"Mariana Ortega Silva",
   "professional_title":null,"current_company":null,
   "profile":{"location":{…},"skills":["Go"],"years_of_experience":"4.5","seniority":"senior",
              "education":{"highest_completed":"bachelor","in_progress":"master"},
              "languages":[{"code":"en","level":"C1"}]},
   "participations":{"total":2,"active":1},
   "latest_participation":{"vacancy":{"id":"…","title":"Backend Go",
                                      "lifecycle":{"publication":"published","process":"active"}},
                           "stage":{"id":"…","name":"Entrevista"},
                           "state":"active","applied_at":"2026-10-21T18:02:11Z"},
   "last_activity_at":"2026-10-21T18:02:11Z"}],
 "total":37,
 "next_cursor":"…"|null}
```

- No contact (email/phone) in list items, as on the board; contact is detail-only.
- `latest_participation` is null for a manual record with no participation.
- `professional_title` / `current_company`: string or null, from the profile source
  below. Manual records read them live; the organic snapshot does not store them,
  so they are **always null for organic** candidates in v1.
- `vacancy.lifecycle` = the vacancy's lifecycle pair, as in the vacancy lifecycle API:
  `publication` null (never published) | `published` | `paused` | `closed`, and
  `process` null | `active` | `finished`.
- `state` is `active` or `discarded`. `applied_at` is the intake date, as on the board
  (a manual intake is «Ingreso manual», never an application).
- Order: `last_activity_at DESC, kind, id` (most recent first). `last_activity_at` =
  latest participation `applied_at`, or the manual record's `created_at` when it
  has none.
- `total` = exact count of the filtered pool (independent of the cursor).
- `limit` 1–50, default 20. `next_cursor` is opaque, bound to the normalized
  filters; reusing it with other filters is `invalid_cursor`.

### Filters

OR within a repeatable key, AND across keys; same matching rules as the board's
client-side filters (board-filter-data.md, «Client-side filters»), now applied
server-side over the whole pool. `none` selects missing values («Sin dato»).

| Key | Values |
| --- | --- |
| `q` | text 1–100 code points; case-insensitive substring of full name or email |
| `origin` | `manual` \| `organic` (one) |
| `vacancy` | repeatable vacancy (job-draft) id: candidates with a participation in any of them |
| `state` | repeatable MX state id or `none` |
| `municipality` | repeatable municipality id or `none` |
| `seniority` | repeatable literal or `none` |
| `years` | repeatable `0_1`, `1_3`, `3_5`, `5_plus`, `none` (decimal-aware `[0,1)`…`[5,∞)`) |
| `language` + `language_min_level` | repeatable code (or `none`); optional level `A1`…`C2`, `native` (lowercase, same literals as profiles) applied to the selected codes |
| `education_level` + `education_in_progress` | one minimum level; `education_in_progress=true` also matches `in_progress ≥ level` |

Errors: 400 `{"error":"…","code":"invalid_filter","fields":[{"field":"years","code":"invalid"}]}` — the shared validation-style `fields` array (same item shape as `validation_error`), one entry per offending key, sorted by key; field codes are `unknown`, `invalid`, `duplicate`, `required`, `not_found` (unknown key, bad value, duplicate
one-valued key, `language_min_level` without `language`, `education_in_progress`
without `education_level`); a `vacancy` that does not exist in the company is
`{field:"vacancy", code:"not_found"}`; 400 `invalid_cursor`. No facet counts in v1:
filter options come from the existing catalogs (vacancy list, geo, languages).

## Detail

`GET /v2/me/company/candidates/{kind}/{id}`

```json
{"kind":"manual","id":"…","full_name":"Lucía Ramírez Torres",
 "professional_title":"Desarrolladora Frontend","current_company":null,
 "contact":{"email":"lucia@example.com","phone":"+523312345678"},
 "profile":{…six keys…},
 "participations":[{
    "id":"…","vacancy":{"id":"…","title":"Backend Go",
                        "lifecycle":{"publication":"published","process":"active"}},
    "stage":{"id":"…","name":"Nuevos"},"state":"active"|"discarded",
    "substate":{"id":"…","name":"Esperando respuesta"}|null,
    "discard":{"reason":{"group":"recruiter","key":"other"},"comment":"…"|null,
               "discarded_at":"…"}|null,
    "source":"manual"|"organic","applied_at":"…",
    "added_by":{"id":"…","name":"…"}|null,
    "cv":{"file_name":"cv.pdf","uploaded_at":"…"}|null}],
 "created_by":{"id":"…","name":"Tomás Ríos"|null}|null,
 "created_at":"…"}
```

- Contact: manual → company record; organic → account email + current profile
  phone (same rule as the board detail). Each value string or null.
- Participations: every participation in the company's vacancies, most recent first.
  `discard` uses the board's discard reason vocabulary ([pipeline-discard.md](pipeline-discard.md));
  it is null unless the participation is currently discarded. `added_by` is as on the board.
- `created_by` / `created_at`: manual → the recruiter who created the record (name null
  if the account no longer exists) and its creation time; organic → `created_by` null and
  `created_at` = first participation `applied_at` in the company.
- CV download: `…/participations/{participationId}/cv` streams the exact CV that
  participation references (company CV or candidate CV version), after checking the
  participation belongs to this candidate and company; 404 otherwise.
- Unknown `kind` or malformed id: 404.

## T2 implementation notes and test map

T2 introduced the list route. The applications-owned `application/pool`,
`infrastructure/http/pool` and `infrastructure/postgres/pool` slices do not invoke
board owner/principal authorization. `cmd/api/pool_context.go` projects jobs-owned
pipeline names (defaults or stored configuration), without authorizing a vacancy.

The SQL scopes participations to the company before identity aggregation and
latest-snapshot selection. Filters and the exact total precede the cursor;
count and page share a statement snapshot in a read-only repeatable-read
transaction. Lookahead is `limit+1`. The cursor is company/filter-bound, strict
versioned base64url JSON, bounded to 4096 encoded bytes, with microsecond UTC
positions. Repeatable selections are sorted/deduplicated; search text is trimmed
and lowercased for binding. `limit` is not part of the filter hash.

Shared `httpjson.WriteInvalidFilterFields` explicitly adds the validation array;
the generic public-jobs error writer is unchanged. `invalid_cursor` is additive;
existing draft-list errors retain their existing `invalid_request` code.

| Test | Evidence covered |
| --- | --- |
| `cmd/api/org_candidates_routes_test.go` — `TestOrgCandidates*` | Real router/service; no-store gates; exact item/empty-profile JSON; default 20/max 50; total and continuation; normalized filter binding; all syntax error categories and sorted fields; strict cursor mutations, bounds, and generic internal errors. Reader fake does **not** prove SQL matching. |
| `cmd/api/org_candidates_flow_integration_test.go` — `TestOrgCandidatesFlow` | Real JWT/gates/SQL: whole-company visibility for non-principal recruiters; manual without participation; organic/manual reuse deduplication; discarded membership; foreign-company exclusion; latest company snapshot including timestamp ties; no live organic profile/contact leakage; every filter and `none`, OR/AND, decimal buckets, all education/language threshold pairs, in-progress/paused/incomplete education, live manual reads; full ordered traversal, exact filtered totals, canonical cursor continuation and company/filter mismatch; catalog errors even on empty results; stored pipeline names and lifecycle pair. |
| `internal/shared/httpjson/pool_errors_test.go` | Exact fields/cursor envelopes and unchanged generic public invalid_filter bytes. |
| `cmd/api/public_jobs_routes_test.go` — `TestPublicJobsInvalidFilterBytesUnchanged` | Actual GET /v2/jobs invalid_filter bytes and public cache headers unchanged. |
| `cmd/api/main_test.go`, `task63_logging_security_a1h_test.go` | Updated exact route topology and bounded logging census. |

Validation from `backend/`: `go test ./cmd/api -run '^TestOrgCandidates' -count=1`,
`go test ./... -count=1`, `go vet ./...`, `go vet -tags=integration ./...`,
`go run ./cmd/archguard`, and scoped gofmt passed. RED evidence: 34 absent-route
HTTP subtests; later one missing cursor catalog test and two cursor-normalization
subtests failed as intended before their respective fixes.

**DB execution is assigned to the parent**, not established by compilation or
skips. With the guarded loopback `DRAFT_TEST_DATABASE_URL` harness already injected,
run (no DSN should be printed):

```sh
go test -tags=integration ./cmd/api -run '^TestOrgCandidatesFlow$' -count=1 -v
go test -tags=integration ./cmd/api -run '^Test(DraftFlow_|DraftListFlow_|ManualCreateHTTPFlow$)' -count=1 -v
```

The second command exercises existing flows sharing the modified router harness.
Parent T2 DB acceptance and the fixture corrections are recorded in the task log (L7).

## T3 implementation notes and test map

Detail reuses the list's company-scoped identity/latest-profile SQL inside one
read-only repeatable-read transaction. All company participations are ordered by
`applied_at DESC, id DESC`; stage labels include retired stages, and substate
names come from the current vacancy catalog. Only contact reads the current
organic phone; no live organic profile attributes enter the six-key projection.
Manual creators retain their ID with a null name for soft-deleted accounts.

CV membership is checked against company, candidate kind/ID and participation ID
before storage is opened. Reads use the exact referenced candidate version or
company CV, including removed candidate-library entries, matching the board.
Headers also match the board: its filename label receives the content-type
extension (including an already-suffixed company filename); no storage keys enter
responses. Storage absence returns the existing `cv_storage_unavailable` error.
No new logging calls, migrations or dependencies were added.

- `cmd/api/org_candidates_detail_routes_test.go`: 15 new HTTP subtests observed
  absent-route RED, then GREEN: both gates/no-store, manual/organic JSON,
  malformed/unknown identities, missing candidate/wrong participation, file
  bytes/headers and sanitized internal/storage errors.
- `TestOrgCandidatesFlow/detail_and_exact_CV`: real SQL/auth/private storage;
  exact detail and nested key allowlists, manual contact/creator, manual without
  participation, deleted creator name, organic account email/current phone vs
  frozen profile, manual reuse, ordering, discard/substate/added-by, company
  isolation, exact company and removed-library candidate CV versions/headers.
  Its temporary stage/substate placement is restored before T2 pipeline tests.
- `cmd/api/main_test.go`: both additive registrations are pinned in topology.

Parent runs the same DB command above. Initial parent runs exposed a missing
fixture catalog version and an incorrectly unquoted filename expectation; the
fixtures were corrected. A detail-only stage placement also triggered T2's
pipeline impact guard and is now restored in subtest cleanup. Do not infer SQL
acceptance from unit tests, vet or a skipped integration run.

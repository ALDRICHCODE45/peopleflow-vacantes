# Public salary filters (SAL-5..SAL-8)

Backend side of the public salary filters on `GET /v2/jobs`, delivered with the frontend agent (`feat/public-salary-filters-ui`).
Branch `feat/public-salary-filters` from main 1f740af. Rules: `docs/recruitment-business-rules.md` §12.1.

## Specs

- **S1.** SAL-5: «Public salary filters must never compare against hidden internal compensation. Vacancies with hidden salary remain eligible for searches **without** salary criteria but are excluded whenever a public amount/range filter is active.»
- **S2.** SAL-6: «Public salary filters let users select currency, pay period and gross/net basis. Compare published salaries only when all three match, without implicit conversions.»
- **S3.** SAL-7: «Match ranges when the published offer overlaps the requested range at least partially. A fixed amount matches when it falls within the requested range. Example: a `30–40k` search matches a `35–45k` offer and a fixed `38k` offer, provided currency, pay period and gross/net basis match.»
- **S4.** SAL-8 resolved by the user (relayed by the frontend): «(1) bordes inclusivos; (2) se permite un solo extremo: «desde X» = ofertas con max o monto fijo >= X; «hasta Y» = ofertas con min o fijo <= Y; (3) unidades por defecto MXN·mensual·bruto en la UI, obligatorias solo si hay monto.»
- **S5.** Agreed contract (L2): keys `salary_min`, `salary_max`, `salary_currency` (MXN|USD), `salary_period` (hourly|weekly|semimonthly|monthly|yearly), `salary_basis` (gross|net), single-valued; `400 invalid_filter` for blank, repeated, bad money grammar, bad enum, min > max, a missing unit with an amount, or units without an amount. Matching only against the public projection compensation; legacy rows and null compensation excluded while active. Amounts normalized to two decimals before cursor binding; the hash is unchanged when no salary filter is active.

## Tasks

- [x] T1 — S1–S5: parser, cursor binding, SQL matching, docs, unit + integration tests (inline) — this commit

## Log

- **L1.** Frontend request (intercom 86f6306c, 2026-10-21): the user chose this cut; proposal for keys/matching on `GET /v2/jobs` and the question whether a published one-sided range exists.
- **L2.** Backend answer: accepted with precisions. `publicjobs.BuildProjection` already nulls compensation when hidden, incomplete, or a range missing either bound, so no one-sided published range exists and matching against the projection satisfies SAL-5 by construction. Error code `invalid_filter` (same as geo). min == max valid. No migration, no response shape change.
- **L3.** Frontend accepted all five points; no filter echo needed; its canonical URL fills MXN/monthly/gross when an amount has no units, drops units without an amount and drops the whole group when min > max.
- **L4.** Implementation: `ParseQuery` salary keys + `SalaryFilter`, `draftfields.NormalizeMoney`/`CompensationEnumAllowed`, hash appends salary only when active, SQL compares projection compensation with `NULLIF` open bounds (never `''::numeric`), legacy branch excluded while active, docs `backend/docs/public-jobs-v2.md`. RED observed: unit tests failed to compile (no `Query.Salary`); integration test failed 10 subtests with the store wiring disabled. GREEN: unit + integration on an isolated `draft_test` (created in the local container), `go test ./...`, `go vet` (both tags). Differential: a query without salary keys hashes identically to the frozen pre-change binding (test), and the existing geo/flow/enrichment integration tests pass unchanged. Risk: none — additive optional query keys, read-only query, no shared helper behavior changed (`NormalizeMoney` wraps the existing scanner).
- **L5.** Integration evidence: on a freshly created `draft_test`, `go test -p 1 -race -tags=integration ./cmd/api ./internal/features/jobs/infrastructure/postgres/...` green, no data race. Incidents (not regressions): a run on a reused database failed `TestPublicGeoSearchIndexCapability` and two draft-flow tests from accumulated fixtures (main and this branch both pass on a fresh database); a parallel-package run failed every cmd/api test in 0.00s because two packages migrated the same empty database concurrently — run integration packages with `-p 1`.
- **L6.** User approved the merge (relayed by the frontend): «2. Si, por favor.» The frontend integrates both branches as `integrate/public-salary-filters` (UI + `merge --no-ff` of acd89d8) and fast-forwards local main; the backend does not integrate separately. No push (user).
- **L7.** Integrated: local main 13b1bd1 (fast-forward by the frontend; acd89d8 via merge ea9e46d). Frontend reports go build/vet/test of `./internal/features/jobs/...` green on the merge and frontend suite 6164/6165 (only the known flaky draft-save-flow, 37/37 isolated). Branch `feat/public-salary-filters` kept (deletion is the user's call). Not pushed.

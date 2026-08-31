# Exploration: Backend Go Closure Before AWS

## Executive answer

The Go domain is substantially delivered, but it is not yet an objective AWS-ready backend. The closure change should reconcile the seven canonical specifications with the running surface, eliminate the known companies/SQL debt, and deliver four missing production boundaries: a migration binary, a deployable Cognito PostConfirmation Lambda adapter, Cognito JWKS verification, and a hardened/observable HTTP server with CI gates. Docker/Terraform/workers and all locked product non-goals must remain outside this change.

The current evidence supports **Go closure: NO-GO** and **core behavior: near complete**. Latest repository records show build/vet/unit green and serial live integration green, with one intentional rollback placeholder skip. This exploration did not rerun commands; it validated the recorded evidence against current paths and symbols.

## Authority and factual baseline

### Requirement hierarchy

Use this order during proposal/spec reconciliation:

1. The user-approved outcome and locked non-goals in this change.
2. Canonical OpenSpec files under `openspec/specs/*/spec.md` (seven specs).
3. Accepted decisions in archived OpenSpec changes when the canonical text is incomplete.
4. Executable behavior: migrations, SQL, Go symbols, route wiring, and tests.
5. `docs/ROADMAP.md`, architecture/data-model docs, and `README.md` as explanatory material that must be corrected when stale; they do not override canonical specs.

There are exactly seven canonical specs: `identity`, `candidates`, `companies`, `company-membership`, `jobs`, `applications`, and `audit_events`. `industries` is a delivered reference catalog without a canonical spec.

### Current implementation baseline

| Area | Implementation evidence | Test/evidence anchor | Baseline |
|---|---|---|---|
| Composition | `backend/cmd/api/main.go::run`, `buildVerifierFromEnv`, chi route wiring | `backend/cmd/api/main_test.go` AST guards | Delivered; production hardening incomplete |
| Identity | `identity/.../post_confirmation.go::PostConfirmationHandler.Handle`; `auth/rsa_verifier.go::RSAVerifier.Verify`; users migration/query/repo | identity unit + `00005_integration_test.go`; archived identity verify | Domain delivered; no Lambda executable and no JWKS verifier |
| Candidates | `CandidateHandler`, `CandidateService`, `CandidateRepository`; migration `00006` | candidate entity/VO/use-case/handler/repository tests and `00006_integration_test.go` | Delivered behavior; canonical field contract incomplete |
| Companies | `CompanyService`; `CompanyRepository::{Create,GetByID,UpdateCompany,SoftDeleteCompany}`; bootstrap owner transaction | companies handler/use-case tests; write integration suite | Delivered; known W1–W6 and Create/GetByID DB debt remain |
| Membership | `CompanyMemberService`, `RequireCompanyRole`, membership repository | middleware/handler tests; membership live integration | Delivered |
| Jobs | `JobService`, `JobHandler`, `JobRepository`; migrations `00007`/`00008` | broad unit + live repository/migration tests | Delivered; canonical stale clauses remain |
| Applications | application service/handler/repository with transactional audit co-write | application unit + live integration and migration tests | Delivered |
| Audit | append-only entity/port/postgres adapter; migration `00011` | vocabulary/metadata/port/migration/co-write tests | Delivered |
| Industries | `industries/http.ListIndustries`; `ListActiveIndustries` SQL | only incidental composition/DB coverage located | Delivered but under-specified and under-tested |
| Health | inline `/healthz` handler in `cmd/api/main.go` calls `pool.Ping` | no focused runtime contract test located | Implemented but under-specified |

Recorded latest evidence: `openspec/changes/archive/2026-08-26-companies-write/verify-report.md` reports build, vet, unit, and serial live integration PASS, with `TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder` skipped. The parent-confirmed latest aggregate is 811 live integration passes. Treat 811 as recorded evidence to reproduce in closure CI, not as a result rerun by this exploration.

## Capability matrix

Legend: **C** complete against canonical behavior; **D** documented/implementation drift; **T** test debt; **R** missing production runtime boundary. Severity is relative to starting AWS implementation.

| Capability / official requirements | Implementation evidence | Test evidence | Status | Gap | Severity |
|---|---|---|---|---|---|
| Identity: users migration, VOs, entity, sentinels | `00005_create_users.sql`; identity domain | migration/domain tests | C | None found | — |
| Identity: idempotent create, reads, error mapping, use cases | users SQL/repository/use cases | repo/use-case + live redelivery tests | C/T | Direct live adapter branch coverage should remain in gate | SHOULD |
| Identity: PostConfirmation handler | `PostConfirmationHandler.Handle` | `post_confirmation_test.go`, live redelivery | R/D | Canonical path text is wrong; no AWS Lambda event adapter/executable | MUST |
| Identity: JWT middleware | `RSAVerifier.Verify`, `RequireAuth`, route wiring | verifier/middleware/AST tests | R/D | Static PEM only; canonical explicitly defers JWKS | MUST |
| Candidates: self-service access and no-IDOR | service/repo/handler, `/me/profile` mount | use-case/handler/repo tests | C | None found | — |
| Candidates: field validation | VOs and full handler DTO | VO/use-case/handler tests | D | Canonical names only three rules, not the delivered full field set; request typo `json:"field_of study"` | MUST |
| Candidates: language replacement, lifecycle, auth | repository transaction and `/me/profile/languages` routes | unit/live/route tests | C/D | ROADMAP says `/me/languages`, contrary to actual/canonical path | MUST docs |
| Companies: public create/read | `POST /companies`, `GET /companies/{id}`; bootstrap transaction; `CompanyRepository::{Create,GetByID}` | handler/use-case/bootstrap tests | D/T | Canonical Companies spec describes but has no create/read requirements; no direct live DB tests for adapter Create/GetByID | MUST |
| Companies: PATCH endpoint/fields | update handler/use case/repository/SQL | unit + live partial/CAS tests | T | W2/W3/W4/W5: multi-field, missing/malformed PATCH CAS, 409 parity/redaction, explicit no-event outcomes | MUST |
| Companies: PATCH CAS | `UpdateCompany` SQL CAS | stale-CAS live test | T | True two-writer race absent (W6) | MUST |
| Companies: DELETE/CAS/atomic close | `SoftDeleteCompany`, `CloseCompanyJobs` | live state test | T | W1 rollback-on-close failure is an intentional skip; malformed/concurrent cases incomplete | MUST |
| Companies: visibility/auth/audit | liveness middleware, filtered reads, co-write audit | middleware/live/audit tests | C | Old comments still claim no-audit in test preambles | SHOULD cleanup |
| Company membership: schema/resolution/read/list/mutations | migration, service/repo/handlers | unit + live integration | C | No functional gap found | — |
| Company membership: role/liveness middleware and route surface | `RequireCompanyRole`; root wiring | middleware/AST/live tests | C | Keep architecture gate to prevent route/import drift | SHOULD |
| Jobs: public reads/visibility/schema/status/FTS/filters/keyset/enums | migration/query/service/handler | extensive live/unit tests | C/D | `Status Domain` still says transitions/endpoints are out of scope | MUST docs |
| Jobs: PATCH/editability/transitions/CAS/IDOR/DTO/errors | use cases/repo/handler/route | extensive unit/live tests | C | No known behavioral blocker | — |
| Jobs: create/draft/active-company gate/response/errors | create use case/repo/handler | unit/live tests | C | Top-level purpose understates full write surface | MUST docs |
| Jobs: reopen/atomic edits/live-company update gate | update flow | reopen tests | C | Remove delta-era “previously/new” prose during reconciliation | SHOULD docs |
| Jobs: soft delete/concurrency/visibility | soft-delete flow | unit/live tests | C | No known blocker | — |
| Applications: schema/status/transitions | migration/domain | migration/domain tests | C | None found | — |
| Applications: apply/auth/no-IDOR/atomic eligibility/no-double-apply | handler/service/repository SQL | unit/live tests | C | None found | — |
| Applications: candidate list and DTO | list flow | unit/live tests | C | None found | — |
| Applications: recruiter list/detail/PII/caps/soft-delete history | recruiter flow | unit/live tests | C | None found | — |
| Applications: transition/race/error/security | transition flow | unit/live tests | C | Deliberate no-CAS behavior is canonical | — |
| Applications: two audit emissions and fail-closed co-write | application repository + audit adapter | rollback/co-write live tests | C | None found | — |
| Audit: schema, actor/event vocabularies, append-only port | migration/entity/port/query | unit/migration tests | C | None found | — |
| Audit: co-write atomicity and PII-free metadata | application/companies adapters | live rollback/metadata tests | C | No read API is intentionally locked out | — |
| Industries catalog | `ListIndustries`, active-only query, duplicate route registration | no focused handler/contract test located | D/T | No canonical requirement; duplicate registration in `main.go`; active semantics and response need tests | MUST |
| Health/readiness | inline `/healthz` DB ping | no focused test located | D/T | No canonical contract; liveness vs readiness semantics unresolved | MUST |
| Migration execution | Make target uses goose tool | migration suites | R | Documented `cmd/migrate` one-off executable does not exist | MUST |
| HTTP production boundary | `http.Server` has only `ReadHeaderTimeout`; chi request/log/recover middleware | no server hardening tests located | R | Missing read/write/idle timeouts, request-body caps, explicit readiness, controlled error/log policy | MUST |
| Observability | JSON `slog`, chi RequestID/Logger | incidental tests only | R | Request ID is not consistently attached to structured domain/error logs; no metrics/tracing/readiness policy | MUST minimum / SHOULD telemetry |
| CI quality gate | Make targets for unit/integration/build/vet | archived manual evidence | R | No workflow; no enforced fmt, race, serial live DB integration, migration/sqlc drift, vuln/lint/architecture gate | MUST core / SHOULD extra |

## Official drift and contradictions to reconcile

1. `docs/ROADMAP.md` says migrations are at version 8; the repository has `00009`–`00011` and current behavior depends on them.
2. ROADMAP says companies have “50 tests” and later marks `UpdateCompany`/`DeleteCompany` pending although the same document says they are delivered.
3. ROADMAP says candidates expose `/me/languages`; actual and canonical routing is `/me/profile/languages` (`r.Mount("/profile", candidateHandler.Routes())`).
4. ROADMAP calls Cognito auth “real”; production currently requires a static `IDENTITY_JWT_PUBLIC_KEY_PEM`, not Cognito `kid`/JWKS rotation.
5. `openspec/specs/identity/spec.md` names `application/identity/post_confirmation.go`; actual path is `backend/internal/features/identity/application/post_confirmation.go`.
6. Identity canonical text explicitly says “JWKS deferred”; that conflicts with the approved pre-AWS production verifier outcome and must be modified.
7. Companies canonical Purpose includes `POST /companies` and `GET /companies/{id}`, but no normative requirement/scenario defines either surface.
8. Industries and `/healthz` are official/delivered surfaces with no canonical specs.
9. Candidates canonical spec does not define the complete persisted/wire field set implemented by migration `00006` and `CandidateHandler`; it therefore cannot detect DTO/schema drift. The request tag `json:"field_of study"` contradicts response/model naming `field_of_study` and is likely an API defect.
10. Jobs canonical `Status Domain` says publish/close transitions and endpoints are out of scope, while later requirements normatively deliver PATCH transitions, reopen, create, and delete.
11. Jobs Purpose foregrounds PATCH while the same canonical file now includes POST and DELETE; delta-era “Previously”/“NEW” prose obscures the final contract.
12. `docs/arquitectura-backend-proyecto-04.md` says five contexts, places invitations under companies, leaves audit ownership unresolved, and describes a `cmd/migrate` that is absent. Current code has seven canonical contexts plus the industries catalog.
13. The architecture doc recommends cross-feature consumption through another feature's application layer/events, while current code contains deliberate cross-feature domain/port imports (for example companies repository audit types). The rule needs either an explicit approved exception or enforcement-compatible refactoring.
14. `docs/modelo-de-datos-proyecto-04.md` claims nine entity tables plus industries and includes `invitations`; no invitations migration/code exists and invitations are a locked non-goal.
15. The data model's `jobs` DDL includes `created_by`; actual migration `00007_jobs.sql` does not. It also lists a `jobs_seniority_idx` absent from the actual migration.
16. The data model says Go validates `industry_id` against the active catalog, but current create relies on the FK and maps `23503`; ROADMAP records this as an open decision.
17. The data model presents recruiter candidate-search queries, conflicting with the locked “recruiter candidate search” non-goal if treated as MVP scope; retain only as explicitly future/non-MVP material or remove.
18. The data model and candidate implementation expose `cv_s3_key` on the candidate profile, while CV/S3 lifecycle is locked out. This is a decision gap: reserve/opaque field versus removing the write surface before AWS.
19. Data-model pending items say migration tooling and audit event vocabulary remain undecided; goose and the four-event vocabulary are already decided/delivered.
20. `README.md` presents `/infra` and `/workers` as repository structure and EventBridge/SQS as stack even though those trees are absent and AWS work is explicitly deferred.
21. `backend/cmd/api/main.go` registers industries twice (`Mount` and `Get` for the same path). One canonical registration must remain.
22. Companies integration test comments still describe successful writes as no-audit despite assertions now requiring `CompanyUpdated`/`CompanyDeleted`.

## Go/SQL debt and runtime classification

### MUST before AWS implementation starts

- Close companies W1–W6: replace rollback skip with deterministic failure injection; direct live `CompanyRepository.Create`/`GetByID`; PATCH missing/malformed CAS; multi-field update; 200/409 redaction parity; true concurrent CAS; explicit no-audit on failed outcomes.
- Add live constraint tests that assert both SQLSTATE and named constraint for `companies_size_check` and `companies_founded_year_check`; current tests assert SQLSTATE but not constraint identity and leave cleanup/isolation rough edges.
- Correct candidate `field_of_study` wire tag and specify/test the complete field set, including null/default semantics.
- Specify and test industries plus health/readiness; remove duplicate industries registration.
- Add `cmd/migrate` as a self-contained goose runner suitable for a one-off deployment task, with embedded or reliably packaged migrations and up/status failure behavior.
- Add a real Lambda executable/adapter for Cognito PostConfirmation, translating the AWS event into the existing application handler and wiring Postgres/config/logging. The existing application handler remains reusable.
- Add a Cognito JWKS verifier with issuer/audience/token-use/RS256 validation, `kid` selection, bounded caching, rotation refresh, request cancellation, and fail-closed startup/runtime behavior. Keep static PEM only as an explicit local/test mode.
- Harden HTTP: read-header/read/write/idle timeouts, maximum request-body policy, graceful shutdown verification, normalized JSON/content-type/error behavior, and separated liveness/readiness semantics.
- Establish minimum structured observability: request ID in logs, method/path/status/duration, safe error classification, startup/config and shutdown events, and DB readiness signals. Metrics/tracing may be SHOULD if the AWS observability stack is not yet selected.
- Add repository-enforced quality gates: gofmt check, `go vet`, `go test ./...`, serial live integration with zero unexpected skips, race tests for suitable packages, migration round-trip, and sqlc generation drift. The AWS-hosted CI/CD resource itself remains AWS work, but the commands/scripts and acceptance contract belong here.
- Add an import/route architecture guard or selected linter configuration so the documented boundaries and authenticated route topology fail in CI rather than relying only on review.
- Normalize public/domain error language under an explicit API language decision; never expose raw DB/internal errors.

### SHOULD hardening before production, not necessarily before AWS scaffolding

- `golangci-lint` policy beyond vet (including error handling and test lint), `govulncheck`, coverage trend, fuzz targets for cursor/JWT/JSON boundaries, and broader `-race` coverage.
- OpenTelemetry metrics/traces and SLO dashboards after the AWS telemetry destination is selected.
- Pool limits/lifetime tuning, overload behavior, CORS/allowed-host policy, security headers, and per-route rate limiting once ingress/frontend origins are fixed.
- Refactor the oversized composition root and remove obsolete cycle comments after contract reconciliation.

### AWS-only work — explicitly wait for Go closure

Dockerfile/container image, ECS/Fargate task/service definitions, RDS/RDS Proxy, Cognito resources/triggers, Lambda deployment resources, IAM/KMS/Secrets Manager, CloudWatch wiring, Terraform, EventBridge/SQS/workers, frontend hosting, and CI/CD deployment workflows. No outbox, async worker, CV/S3 lifecycle, candidate search, invitations, restore, FX, or audit read API is promoted by this change.

## Decisions the parent must resolve before proposal

Use the tokens below in a grouped decision prompt; do not expand scope silently.

### Contract decisions

- **C1 — Candidate CV key**: `reserve` (keep `cv_s3_key` nullable but reject/ignore client writes until the CV slice; safest with locked non-goal) / `opaque-write` (retain current client write, accepts an unverifiable storage reference) / `remove-wire` (remove request/response field but keep DB column). Consequence: API compatibility versus enforcing the locked CV boundary. Recommended: `reserve` or `remove-wire`.
- **C2 — Industry validation**: `fk-only` / `active-catalog-in-app` / `atomic-active-sql-gate`. Consequence: inactive industry acceptance and TOCTOU guarantees. Recommended: `atomic-active-sql-gate` if inactive entries must not be selectable; otherwise document `fk-only`.
- **C3 — Error language**: `english` / `spanish` / `stable-codes-plus-message`. Consequence: compatibility and localization. Recommended: stable machine code plus one documented default message language.
- **C4 — Health contract**: `healthz-process+readyz-db` / `healthz-db-only`. Consequence: ECS/Lambda probe behavior during DB incidents. Recommended: split liveness and readiness.

### Runtime decisions

- **R1 — PostConfirmation enablement**: `production-required` (Lambda fails startup/config when disabled) / `flagged` (retain runtime no-op flag). Consequence: silent user-sync loss versus operational rollout flexibility. Recommended: production-required with explicit local/test disable.
- **R2 — JWT modes**: `jwks-prod+pem-local` / `jwks-only`. Consequence: local ergonomics versus smaller configuration surface. Recommended: dual explicit modes, never implicit fallback.
- **R3 — Minimum observability gate**: `logs-only` / `logs+metrics` / `otel-full`. Consequence: scope and AWS coupling. Recommended: structured logs + metrics-ready interfaces now; exporter selection in AWS design.
- **R4 — Go closure gate**: `zero-skips` / `one-known-skip-accepted`. Consequence: whether the rollback placeholder can survive. The approved objective implies `zero unexpected skips`; replace the known placeholder before GO.

### Architecture contradiction decisions

- **A1 — Cross-feature rule**: `strict-refactor` / `document-ports-and-co-write-exceptions`. Consequence: potentially broad refactor versus an enforceable rule matching current audit/identity seams. Recommended: document narrow port/type exceptions and enforce forbidden infrastructure imports.
- **A2 — Locked future material in official docs**: `remove` / `label-future`. Sources: invitations, recruiter candidate search, EventBridge/SQS/outbox narrative, restore, CV lifecycle. Consequence: clarity versus retaining long-range context. Recommended: label future and explicitly non-MVP; remove any text that reads as delivered/current.

## Recommended SDD scope and workstreams

One change is coherent if split into reviewable work units below; implementation should be chained because several units will exceed the 400-authored-line review budget when tests are included.

1. **Requirement closure** — canonical deltas for seven specs plus new narrow runtime/catalog/health capability specs; reconcile ROADMAP/README/architecture/data model in the same behavior work units.
2. **Companies and SQL test closure** — W1–W6, direct Create/GetByID live tests, named constraints, fixture cleanup.
3. **Candidate/catalog contract closure** — full field matrix, `field_of_study`, CV-key decision, industries active semantics, duplicate route removal, health contract tests.
4. **Executable boundaries** — `cmd/migrate` and PostConfirmation Lambda adapter, each independently buildable/testable and rollbackable.
5. **Production authentication** — JWKS verifier/cache/rotation/config with PEM-local mode and middleware regressions.
6. **HTTP and observability hardening** — server/config boundaries, liveness/readiness, limits/timeouts, structured request/error logs.
7. **Quality and architecture gate** — reproducible scripts/config for unit, serial integration, race, vet, fmt, sqlc/migration drift, linter/import guards; finish with the AWS go/no-go report.

Do not bundle Docker/Terraform into workstream 4 or CI deployment YAML into workstream 7.

## Risks, rollback boundaries, and review hotspots

| Risk/hotspot | Control and rollback boundary |
|---|---|
| Canonical reconciliation accidentally promotes non-goals | Spec diff must list locked exclusions; rollback documentation-only work unit |
| JWKS cache/rotation admits stale or wrong keys | Table-driven crypto tests + local JWKS server; rollback to fail-closed static PEM local mode, not permissive auth |
| Lambda adapter duplicates identity logic | Adapter only translates AWS event and composes existing handler; rollback executable/dependency without touching domain |
| `cmd/migrate` packages migrations incorrectly | clean-DB up/down/status runtime test; rollback command while Make/goose developer path remains |
| Failure injection mutates shared DB schema | Prefer injected tx/query seam or transaction-local trigger with guaranteed cleanup; serial integration only |
| HTTP limits break legitimate payloads | Per-route documented limits and boundary tests; rollback middleware/config independently |
| Error normalization breaks clients | Stable error-code decision and contract tests before message cleanup |
| Composition root and AST tests are already large | Extract constructors/server config in one behavior-preserving work unit; keep route guard tests with the move |
| Generated sqlc and test fixtures inflate review | Exclude generated lines from authored budget but include generated files in snapshot; isolate SQL+generated+tests as one work unit |
| Runtime dependencies enlarge supply chain | Pin direct dependencies, run vuln scan, avoid AWS SDK-wide imports where service-specific modules suffice |

Likely >400-line hotspots: JWKS cache plus tests, Lambda adapter plus AWS event/runtime dependencies, companies live-DB closure, server hardening extraction, and CI/architecture guard setup. Use work-unit commits with tests and rollback notes; ask before any over-budget single review slice.

## AWS go/no-go gate

AWS work is **GO** only when all are true:

- Canonical requirement matrix has no unexplained D/R/T rows marked MUST.
- `go build ./...`, `go vet ./...`, gofmt check, unit tests, and selected race suite pass.
- Serial `go test -tags=integration -p 1 ./... -count=1` passes with zero unexpected skips; the rollback placeholder is replaced.
- Fresh migration up/down/up and sqlc regeneration are deterministic.
- `cmd/api`, `cmd/migrate`, and the PostConfirmation Lambda executable build and have runtime-boundary tests.
- Production auth uses tested Cognito JWKS rotation and fails closed on configuration/key-fetch errors.
- Health/readiness, HTTP timeout/body limits, graceful shutdown, and minimum structured observability are contract-tested.
- Companies Create/GetByID, write rollback/CAS races, named constraints, industries, and candidate wire fields have direct evidence.
- Locked non-goals remain absent, and no Docker/Terraform/workers were smuggled into Go closure.

Until then, the objective status is **NO-GO for AWS implementation**.

## Evidence index

- Canonical requirements: `openspec/specs/{identity,candidates,companies,company-membership,jobs,applications,audit_events}/spec.md`.
- Composition/runtime: `backend/cmd/api/main.go`, `backend/cmd/api/main_test.go`, `backend/Makefile`.
- Auth: `backend/internal/features/identity/infrastructure/auth/rsa_verifier.go`; `backend/internal/features/identity/application/post_confirmation.go`.
- Candidate wire contract: `backend/internal/features/candidates/infrastructure/http/handler.go`.
- Companies SQL/adapter/tests: `backend/db/queries/companies.sql`; `backend/internal/features/companies/infrastructure/postgres/companyRepository.go`; `companyRepository_write_integration_test.go`; `migration_check_test.go`.
- Industries/health: `backend/internal/features/industries/infrastructure/http/handler.go`; `backend/db/queries/industries.sql`; inline routes in `cmd/api/main.go`.
- Schema truth: `backend/db/migrations/00001_create_industries.sql` through `00011_create_audit_events.sql`.
- Recorded quality evidence: `openspec/changes/archive/2026-08-26-companies-write/verify-report.md`; `openspec/changes/archive/2026-08-26-companies-audit/archive-report.md`.
- Stale explanatory sources: `README.md`, `docs/ROADMAP.md`, `docs/arquitectura-backend-proyecto-04.md`, `docs/modelo-de-datos-proyecto-04.md`, candidate form document.

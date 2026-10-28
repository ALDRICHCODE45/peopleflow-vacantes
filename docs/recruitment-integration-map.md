# Recruitment integration map — frontend ↔ backend handoff

This document maps what exists in the frontend today against what the backend owner reports as existing, and against the new business extensions agreed in discovery (`docs/recruitment-business-rules.md`). Its purpose is to make the integration gap visible for planning. It is **not** an implementation plan, a contract, or authorization to build.

**Nothing here is runtime-verified.** No services were run, no HTTP calls were made and no production environment was inspected.

## Evidence legend

| Tag | Meaning |
| --- | --- |
| **FE** | Frontend evidence: file exists and was read in this repository. |
| **Local** | The UI is wired to local fixtures, prototype data or component state — not to a network/API path. |
| **Wired** | Client code exists that calls the backend, but a wired request is **not** proof of live success. |
| **BE** | Backend evidence supplied by the backend owner (baseline `main3e9a5d9`, historical `b5a55c6`). Not independently inspected in this session. |
| **?** | Unknown. A surface not found is not proof of exhaustive absence. |

Frontend source of truth for this map is the verified inventory in the parent task plus the frontend paths listed below. Backend claims are attributed to the backend owner's report; they were not re-verified here.

## 1. Capability matrix

### 1.1 Public job board (candidate-facing)

| Capability | Existing UI (FE) | Data path today | Backend existing (BE, supplied) | New business extension | Dependency / open contract |
| --- | --- | --- | --- | --- | --- |
| Job list / search | Job board + filters: `frontend/src/features/jobs/components/JobsResults.tsx`, `JobsNavigationIsland.tsx`, `VacancyCard.tsx` | `api/listJobs.ts` calls the backend; when `PEOPLEFLOW_SAMPLE_JOBS` is enabled the list bypasses the network and serves `sample-jobs.ts` / `prototype-jobs.ts`. Whether the switch is enabled in this checkout and whether live consumption works are **unverified**. | `GET /jobs` — Spanish full-text (`websearch_to_tsquery` + `ts_rank`), six filters (seniority, work_mode, employment_type, location, currency, …), keyset pagination; only `published` vacancies of `active` companies | Public filters: `Idioma adicional`, hide disabled filters (insurance/flexible-hours/training); paused/closed vacancy = excluded from search | Language filter contract (salary filter SAL-5…SAL-8 implemented on `feat/public-salary-filters` / `feat/public-salary-filters-ui`: `salary_min`, `salary_max`, `salary_currency`, `salary_period`, `salary_basis` on `GET /v2/jobs`), filter parity with the six backend filters |
| Job detail | `components/JobDetailView.tsx` | `api/getJob.ts` calls the backend; the same `PEOPLEFLOW_SAMPLE_JOBS` switch can bypass the network for detail. Effective env value and live consumption are **unverified**. | `GET /jobs/{id}` — `published` + `active` company only | `Pausada`/`Cerrada` notice on direct-link detail, keep existing applications, block new applications (VAC-6); public salary only when explicitly enabled (VAC-4) | Direct-link access to paused/closed public detail is an already-agreed behavior (VAC-6); the open item is the **read contract** for that route, not whether the behavior is wanted. Drafts and never-published replacements must never be exposed. |
| Job detail fields | `vacancy-detail-fields`, `components/VacancyCard.tsx`, `formatters.ts` | Local + API-shaped types | Response shape in `jobs` read-side | Separate `Jornada` (schedule) from the contract type catalog (single value) (CAT-6, CAT-1), other benefits as multiple items, restricted rich-editor font sizes | CAT-1/CAT-6 mapping to existing columns; the current UI mixes schedule and contract in one `employment_type` field labeled `Jornada` (`frontend/src/features/jobs/formatters.ts`); separation is an upcoming change, **not implemented** |

### 1.2 Vacancy creation (employer)

| Capability | Existing UI (FE) | Data path today | Backend existing (BE, supplied) | New business extension | Dependency / open contract |
| --- | --- | --- | --- | --- | --- |
| Create vacancy | `frontend/src/features/jobs/create/CreateVacancyForm.tsx`, `CreateVacancyHeader.tsx`, `VacancyPreview.tsx`, `schemas.ts` | `create/createJob.ts` **client exists**; `CreateVacancyForm` is **not wired** to it | `POST /jobs` (recruiter-gated). Later direct owner verification reports `CreateJob` inserting a literal `draft` (`backend/db/queries/jobs.sql`); **static self-report only, no runtime proof and partial-input compatibility unverified** | Mandatory management fields to publish (principal recruiter, requester, request date, headcount, delivery target, cutoff stage, commitment date) (VAC-3); draft must not start the delivery clock (VAC-1) | Requester model (`Área solicitante`/`Cliente`, organization-scoped catalogs) (REQ-1…REQ-5); commitment-date business-day validation (CFG-10/CFG-11); public-content validation vs existing form |
| Draft edit / publish | Form + preview are prototype-grade | No draft edit path wired | `PATCH /jobs/{id}` with CAS `If-Unmodified-Since`; `DELETE /jobs/{id}` soft-delete; `POST /jobs`, `PATCH`/`DELETE /jobs/{id}` are recruiter-gated; reported states `draft/published/closed` | `Borrador`→`Publicada` starts clock; no `Pausada` state today | Lifecycle expansion from 3 to 4 states (`Borrador`, `Publicada`, `Pausada`, `Cerrada`) is a backend contract change; pause/resume time accounting (VAC-5) |
| Soft delete | Not exposed | None | `DELETE /jobs/{id}` soft-delete | — | — |

**Professional-area/requester distinction (REQ-6).** Keep public `Área profesional` (job discipline, e.g. `Tecnología y sistemas` for a backend developer) separate from internal `Área solicitante` / `Cliente` (e.g. `Departamento de TI` / `Cyber Power`). The requester must not appear in candidate-facing output. Professional area is required at publication, not to save an incomplete draft; publication remains outside the first draft slice. The current form's area selector is not a substitute for an organization-scoped requester relation. The initial shared 16-option professional-area catalog is confirmed (REQ-7), replacing the nine prototype choices in upcoming work. Its technical representation and requester catalog integration remain open; no mapping or persistence is implemented by this documentation change.

**Application-deadline field note.** The create form currently exposes an optional `Fecha de cierre` input (`frontend/src/features/jobs/create/form/strategy-section.tsx`) with helper `Fecha límite para recibir postulaciones`, an application deadline held as `closingDate` in the form model. It is **still present today**; the agreed requirement is to remove/defer it from the upcoming draft UI and contract, with no automatic expiry stored. This is separate from the event-generated actual `Fecha de cierre` (INT-26) and must not be treated as a closure timestamp.

### 1.3 Employer portfolio and pipeline (employer)

| Capability | Existing UI (FE) | Data path today | Backend existing (BE, supplied) | New business extension | Dependency / open contract |
| --- | --- | --- | --- | --- | --- |
| Vacancy portfolio | `frontend/src/features/employer-vacancies/` (`model.ts`, `prototype-vacancies.ts`) | **Local** fixtures | `GET /jobs` is public-only; no recruiter-scoped portfolio/list endpoint reported | Per-process pipeline config (PIPE-1, SUB-1, CFG-1) and delivery/commitment settings; lifecycle evaluated per process; logical vacancy grouping original + replacements | Recruiter-scoped vacancy listing/aggregation contract; logical-vacancy model is absent backend-side |
| Pipeline board | `frontend/src/features/employer-vacancies/pipeline-model.ts`, pipeline UI components | **Local** four stages: `submitted`, `in_review`, `hired`, `rejected` | Recruiter list/detail/transition endpoints; fixed `submitted → in_review → hired \| rejected`; uniqueness candidate/vacancy | Six default Spanish columns (`Nuevos`, `Screening`, `Screening OK`, `En proceso`, `Placement`, `Descartados`), ≤3 extra columns, substates in `En proceso`, configurable cutoff, reorder before `Placement` | Stage semantics differ from FE enum (4 vs 6 + substates + configurable order); rename/reorder/insert rules (PIPE-1…PIPE-18); discard reason + recovery (PIPE-12/PIPE-13) |
| Delivery/coverage evaluation | Coverage not modeled; pipeline shows stages | **Local** | Transition endpoints exist; no delivery/coverage accounting reported | Delivery target, historical milestone attainment, coverage increments on `Placement`, decrement on exit, freeze at fulfillment (DEL-1…DEL-10) | Entire delivery/coverage engine is new; cutoff-change historical evaluation (DEL-7) |
| Candidate process documents | Application CV step exists; no process-doc manager found | **Local** wizard state | `cv_s3_key` reserved, **no upload/download/S3 wired** | Placement-level docs, vacancy-level docs, versioning, post-closure attachment (DOC-1…DOC-10) and source→replacement linking (REP-13) | Storage/upload contract absent; retention policy open (PRIV-12) |

### 1.4 Employer dashboard, internal DB, team and settings

| Capability | Existing UI (FE) | Data path today | Backend existing (BE, supplied) | New business extension | Dependency / open contract |
| --- | --- | --- | --- | --- | --- |
| Company dashboard | `frontend/src/features/employer-vacancies/` dashboard surfaces; chart title `Origen de las postulaciones` | **Local**/static | No metrics endpoints; HTTP logging and health exist, metric interfaces are no-ops (no exporter, no `/metrics`), and there are no business metrics | Executive summary (org-wide), separate delivery-time and coverage-time charts, keep `origen` chart (MET-1…MET-5) | New metrics API and aggregation contract; chart data today is static and its title already differs from the `origen de las vacantes` wording noted in discovery (MET-4) |
| Internal candidate DB (`DB interna`) | `frontend/src/features/org-candidates/` — Base de talento over GET `/v2/me/company/candidates` (+ `/summary`), table and card views, detail sheet with audited edits | **Real** | Organization-scoped candidate pool, filters, CSV export with contact | Advanced search (SRCH-9) and global opt-in search remain open | The former local prototype (`features/employer-talent`) was removed. |
| Employer team | `frontend/src/features/employer-team/` — owner/recruiter | **Local** | `GET /me/company`; recruiters can list company members, member/company mutations are owner-only (`/me/company/members`) | Role/action matrix incl. collaborators, Stakeholder read-only, assignment audit (ROLE-1…ROLE-9, ASG-1…ASG-10) | Role model expansion (collaborator + Stakeholder semantics) is a backend contract change; member listing is available to recruiters today, while member mutations are owner-only |
| Employer settings | `frontend/src/features/employer-settings/` — **local** | **Local** | `PATCH/DELETE /me/company` owner-only, CAS | Remove the "applications without CV" setting (INT-17); requester catalogs (`áreas solicitantes`/`clientes`) and custom `other benefits` items (no organization-wide benefit catalog, CAT-2) | Which settings are real server-backed vs presentational must be confirmed |
| Company / careers page | `frontend/src/features/company-profile/`, `frontend/src/features/company-site-editor/` — prototype / careers editor | **Local** | `POST /companies` (creates owner atomically), `GET /companies/{id}`, `GET /me/company`, `GET /industries` | Keep public hiring company separate from internal requester (VAC-4, REQ-4) | Careers page publication contract (public surface vs company profile) is not established |

### 1.5 Candidate-facing surfaces

| Capability | Existing UI (FE) | Data path today | Backend existing (BE, supplied) | New business extension | Dependency / open contract |
| --- | --- | --- | --- | --- | --- |
| Candidate profile | `frontend/src/features/candidate/model.ts`; profile workspace; birth date still present in current UI | Primarily **local** fixtures/workspaces | `GET/PUT /me/profile`, `GET/PUT /me/profile/languages` (transactional) | Remove birth date/age entirely (PRIV-1); languages with level (`básico`…`nativo`) (INT-19); seniority + `Años de experiencia` separate (INT-20/INT-21); education completion status (INT-23) | Existing profile shape must be reconciled with removals; stored birth-date treatment open (PRIV-2) |
| Candidate CVs | `frontend/src/features/candidate/` CV surfaces; CV step in application wizard | **Local** | `cv_s3_key` reserved; no upload/download/S3 | CV mandatory for organic applications and recruiter intake; remove CV-less exemption (INT-17); CV version reference per participation (DOC-7) | Upload/storage contract absent; extraction feasibility unverified (INT-16) |
| Candidate applications | `frontend/src/features/candidate-applications/wizard.tsx` (vacancy processes); legacy catalog rows show a «no recibe postulaciones en línea» state instead of a form | **HTTP** submission for vacancy processes; legacy rows have no apply path (the prototype legacy wizard was removed 2026-10-26) | `POST /v2/jobs/{id}/applications`, `GET /v2/me/applications`; legacy `POST /jobs/{id}/applications` is unused by the frontend | Remove cover letter (INT-18); CV mandatory (INT-17); independent participation per vacancy (INT-5) | Stage model differs from agreed six columns |
| Candidate saved jobs | Saved-vacancies surfaces under `frontend/src/features/candidate/` | **Local** fixtures | No saved-jobs endpoint reported | Not extended in discovery | Saved-jobs persistence contract (?) |
| Candidate dashboard | Candidate dashboard surfaces under `frontend/src/features/candidate/` | **Local** static | No candidate dashboard endpoint reported | Keep recruiter intake invisible to candidate dashboard (INT-3) | Dashboard data contract (?) |
| Candidate settings | Candidate settings workspace under `frontend/src/features/candidate/` | **Local** | `/me/profile` only | Global-directory visibility opt-in, photo sharing opt-in, scope-of-sharing notice (PRIV-3…PRIV-7) | New visibility/preference contract; propagation of visibility changes open |
| Candidate marketing / landing | `frontend/src/features/candidate/` landing surfaces | **Local** | None reported | Not extended in discovery | — |
| Public company jobs page | Company/careers prototype | **Local** | Public `GET /jobs` filtered by company not reported | Careers page tied to public hiring company (VAC-4) | Company-scoped public listing contract (?) |

## 2. Backend-owner supplied baseline (not independently verified)

Attributed to the backend owner; this session did not inspect backend code, run services or execute tests.

- **Router surface:** `backend/cmd/api/router.go` (reported lines 65–116).
- **Jobs:** `GET /jobs`, `GET /jobs/{id}`, `POST /jobs`, `PATCH /jobs/{id}`, `DELETE /jobs/{id}` (writes recruiter-gated). Spanish full-text, six filters, keyset pagination; public responses only `published` vacancies of `active` companies; states `draft`/`published`/`closed`; CAS via `If-Unmodified-Since`; soft-delete. Later direct owner verification reports `CreateJob` inserting a literal `draft` (`backend/db/queries/jobs.sql`); static self-report only, no runtime proof and partial-input compatibility unverified.
- **Candidate profile:** `GET`/`PUT /me/profile` and `/me/profile/languages` (transactional).
- **Applications:** `POST /jobs/{id}/applications`, `GET /me/applications`, recruiter list/detail/transition; uniqueness candidate/vacancy; fixed `submitted → in_review → hired | rejected`.
- **Companies:** public company read, `POST /companies` creates owner atomically, `GET /me/company`; recruiters can list company members while member and company mutations are owner-only; `GET /industries`.
- **Audit:** partial transactional fail-closed `audit_events` (migration `00011`); **no query API and no universal audit**.
- **Vacancy checklist (v1, backend verified):** `GET/PUT /v2/me/company/job-drafts/{id}/checklist`, recruiter owner-or-principal gate, independent version/ETag, required `If-Match`, exact field validation, retired-reminder filtering and finished-process write protection. `JobDraftChecklistConfigured` is co-written with JSON-string previous/new snapshots; identical stored PUTs are no-ops. Automatic candidate evaluation remains frontend-owned.
- **Documents/CVs:** `cv_s3_key` reserved; **no upload/download/S3 wired**.
- **Observability:** HTTP logging and health endpoints exist; metric interfaces are no-ops with no exporter and no `/metrics` endpoint, and there are **no business metrics**.
- **Absent backend-side:** new pipeline model, metrics, replacements and global directory.
- **Tests:** existing unit, HTTP, repository and integration tests; historical evidence, so not current proof. Unit/local-Postgres tests do not require AWS.
- **Auth:** valid JWT and local memberships required; RS256 PEM is for local only.
- **Infra:** `infra/` and `workers/` are future/no-MVP; target-architecture diagrams are not deployment evidence; the PostConfirmation binary is not proof of a deployed Lambda. External AWS deployment is unknown.
- **Constraints:** reuse existing backend/auth foundations; no auth bypass; no AWS rebuild authorization. Document/CV extraction may need dependencies not yet available; LinkedIn/OCC import feasibility remains unverified.

## 3. Key integration gaps (summary)

1. **Data path is sample-switched.** The job list/detail clients exist and `PEOPLEFLOW_SAMPLE_JOBS` can bypass the network to sample fixtures. Whether the switch is enabled in this checkout and whether the public surface consumes the live backend are **unverified**.
2. **Creation is not wired.** `createJob.ts` exists; the create form does not call it.
3. **Employer side is almost entirely local.** Portfolio, pipeline, dashboard, internal DB, team, settings and careers surfaces use fixtures or component state.
4. **Candidate side is local.** Profile/CVs/saved jobs/dashboard/settings are primarily local. The application wizard performs local draft, validation and CV selection with **no HTTP submission or persistence**; its final action links to the candidate login.
5. **Stage models diverge.** FE pipeline enums (`submitted`/`in_review`/`hired`/`rejected`) and backend fixed transitions do not match the agreed six Spanish columns plus substates and configurable order.
6. **Lifecycle diverges.** Backend has three states; agreed model has four (`Borrador`, `Publicada`, `Pausada`, `Cerrada`) plus separate delivery and coverage dimensions.
7. **Most new backend is not established.** The owner report establishes no delivery/coverage, documents, metrics, replacements or global-directory backend; internal-candidate support is **not established** (not proven absent).
8. **Test isolation is intentional.** Source-isolation tests deliberately keep prototype UI disconnected from real data. Evolving them requires behavioral review, not blind deletion.
9. **Unknowns stay unknown.** A dedicated document/intake surface not being found does not prove exhaustive absence; dashboard/careers/saved-jobs persistence contracts are `?`.

## 4. Open contracts to settle with the backend owner

- Recruiter-scoped vacancy portfolio and logical-vacancy grouping (original + replacements).
- Configurable pipeline (columns, order, substates, cutoff) and its read/write contract.
- Delivery and coverage evaluation, historical freezing and cutoff-change evaluation.
- Lifecycle expansion to four states with pause/resume time accounting.
- Recruiter-scoped metrics and org-wide executive-summary aggregation.
- Internal candidate records, org-scoped visibility, card+table views and advanced search (structured + Boolean CV).
- Global talent directory with candidate-controlled visibility and propagation on deactivation.
- Document/CV storage, upload/download, versioning and retention hooks.
- Requester catalogs (`áreas solicitantes` / `clientes`). The initial currency catalog (`MXN`, `USD`) and pay-period catalog (`por hora`, `semanal`, `quincenal`, `mensual`, `anual`) are confirmed (SAL-2); their technical representation and cross-unit comparison remain open contracts. Custom `other benefits` are items beside predefined benefits, with **no organization-wide benefit catalog approved** (CAT-2); requester catalogs are distinct from benefits.
- Application payload changes (drop cover letter, require CV) and stage-model reconciliation.

## 5. Verification notes and limitations

- Backend statements are **supplied evidence**, not independently reproduced. No backend files were read in this session by the author of this document.
- No HTTP calls, services, tests or builds were run.
- Frontend paths were confirmed to exist; pipeline stage names and the dashboard chart title come from the verified inventory in the parent task, not from re-reading every component here.
- The earlier scout claim of selectable talent cards was **retracted**; the internal talent view is a local table/detail without selectable cards today.
- "Wired" means client code exists. It does **not** assert a successful live request.
- No line numbers are given for frontend paths on purpose, to avoid inventing unstable references.

## 6. Source

- Agreed business behavior: `docs/recruitment-business-rules.md`, derived from `odd/discovery/recruitment-business-rules.md`.
- Frontend evidence: verified inventory supplied with this task; paths re-confirmed to exist in this repository.
- Backend evidence: backend owner report (baseline `main3e9a5d9`, historical `b5a55c6`). Not independently inspected.

# Design: `jobs-create`

Status: design. Grounded by `openspec/changes/jobs-create/proposal.md`, `exploration.md`, and the delta spec `openspec/changes/jobs-create/specs/jobs/spec.md`. The delta spec is authoritative for observable behavior; this document turns that behavior into component-level architecture.

Locked decisions are **not** re-opened here:

- POST creates in `draft` (explicit INSERT value, not the DB DEFAULT).
- Required field set = `title`, `description`, `work_mode`, `employment_type`, `seniority`; `salary_currency` optional (default `MXN`); `location` / `salary_min` / `salary_max` optional.
- Active-company check is an **atomic SQL guard inside the INSERT** (no TOCTOU).
- `201 Created` + full `JobEditorViewDto`; `409 Conflict` for `ErrCompanyNotActive`.
- `salary_min <= salary_max` validated only when **both** fields are present and non-nil (mirror PATCH).
- No dedupe (no `23505` mapping), no migration.

Reference slice: `jobs-write-side` (archived at `openspec/changes/archive/2026-08-24-jobs-write-side/`), which already delivered the VOs, `entities.JobForUpdate`, `toEditorView`, the gated-route pattern, `classifyError`, and the postgres adapter helpers this change reuses. The `companies` slice is the POST precedent (201 + full body, `RequireAuth`, `map*CreateError`).

---

## 1. Context and scope

`jobs-write-side` closed the write loop for editing/publishing/closing an existing row, but the only producer of `INSERT INTO jobs` today is direct SQL. This change adds `POST /jobs` — a gated, company-scoped create endpoint — reusing the same vertical-slice machine: parsed VOs, `JobForUpdate` projection, editor-view DTO, `classifyError`, and the composition-root routing split. A freshly-created row is born `status='draft'` and is therefore invisible to the public read path (which requires `status='published'`), so the create response's `updated_at` doubles as the CAS token for the client's immediate `PATCH /jobs/{id}` publish.

**No migration.** The `jobs` table already carries every column the create path needs (`00007_jobs.sql`). Domain-only validation (non-empty title/description, `salary_min <= salary_max`) stays in the use case, mirroring PATCH.

---

## 2. Decisions at a glance

| # | Decision | Choice |
|---|---|---|
| D1 | `CreateJob :one` SQL guard shape | Atomic nested CTE: `WITH active AS (…) , ins AS (INSERT … SELECT … FROM active RETURNING …) SELECT … FROM ins JOIN active`. |
| D2 | RETURNING column set + entity mapping | Exact `GetJobForUpdateRow` column set (15 cols), reuse `toJobForUpdateEntity` + `toEditorView` via a thin row-lift (`createRowToGetForUpdateRow`). |
| D3 | `search_vector` exclusion | Hard rule: excluded from INSERT column list AND both RETURNING/SELECT lists. |
| D4 | UUID v7 generation | Use case calls `uuid.NewV7()`; no shared helper; `github.com/google/uuid` already imported. |
| D5 | `salary_currency` default site | Use case defaults `nil → valueobjects.MXN`; INSERT always writes an explicit value (never relies on the DB DEFAULT). |
| D6 | `CreateJobDto` shape | Plain non-pointer required strings + `*string`/`*int` optionals; no `Optional[T]`; no `id`/`company_id`/`status`/timestamps. |
| D7 | Repository port + adapter | `Create(ctx, id, companyID, params) (*entities.JobForUpdate, error)`; `buildCreateJobParams`, `mapCreateError`, `intPtrToInt4`, `createRowToGetForUpdateRow`. |
| D8 | Use case `CreateJob` | 8-step deterministic flow (validation → VOs → default → UUID → params → `repo.Create` → project). |
| D9 | Handler + wiring | `createJob` handler, `JobHandlers.CreateJob`, `classifyError` +2 branches, `r.With(requireAuth, requireRecruiter).Post("/jobs", …)`. |
| D10 | Tests | RED-first: DTO decode, use case steps, adapter helpers, handler, build-tagged SQL integration. |

---

## 3. Domain layer

### 3.1 New sentinels — `entities/job.go` (MOD)

```go
// ErrCompanyNotActive is returned when the owning company is not `active`
// at INSERT time (suspended / pending_verification) or — defensively —
// when the atomic guard yields zero rows because the company is missing.
// The HTTP layer maps this to 409 Conflict ("company is not active").
var ErrCompanyNotActive = errors.New("company is not active")

// ErrCompanyGone is the defense-in-depth sentinel for SQLSTATE 23503
// (foreign_key_violation on jobs.company_id). It is unreachable via the
// designed flow: the `active` CTE filters by `companies.id = $company_id`,
// so a missing company yields zero rows (→ ErrCompanyNotActive), never a
// FK violation. It exists to keep the adapter boundary typed if a future
// query shape drifts. The HTTP layer maps it to 409 Conflict.
var ErrCompanyGone = errors.New("company is gone")
```

- `ErrCompanyNotActive` is pinned by the proposal/spec; `ErrCompanyGone` is the proposal's §6.3 defense-in-depth mapping (kept distinct at the adapter, see D7).
- No other sentinels are added. `ErrEmptyTitle`, `ErrEmptyDescription`, `ErrInvalidSalaryRange`, and the four `valueobjects.ErrInvalid*` are reused verbatim from PATCH.

### 3.2 Create params value type + port extension — `domain/repositories/jobRepository.go` (MOD)

The port stays free of generated SQL types and of UUID generation. The use case owns UUID generation and param construction (no `entities.NewJob` factory — the domain remains a pure read model for jobs, matching the package contract).

```go
// CreateJobParams is the validated, parsed input the use case hands to
// JobRepository.Create. The use case owns UUID generation (id) and VO
// parsing; the adapter maps VOs to canonical wire strings and optional
// pointers to nullable pgtypes.
type CreateJobParams struct {
	Title          string
	Description    string
	WorkMode       valueobjects.WorkMode
	EmploymentType valueobjects.EmploymentType
	Seniority      valueobjects.Seniority
	Location       *string
	SalaryMin      *int
	SalaryMax      *int
	SalaryCurrency valueobjects.SalaryCurrency // always non-nil (nil → MXN in the use case)
}
```

Add to `JobRepository`:

```go
// Create atomically inserts a draft job owned by `companyID`, guarded by
// the active-company predicate inside the same statement. Returns the
// created row mapped to *entities.JobForUpdate (so the use case reuses
// toEditorView verbatim). Error contract:
//
//   - entities.ErrCompanyNotActive  on 0 rows (non-active / missing company)
//   - entities.ErrCompanyGone       on 23503 (FK, defense-in-depth)
//   - entities.ErrInvalidStatusTransition on 23514 (CHECK, defense-in-depth)
//   - other error                    propagated untouched (HTTP 500)
Create(ctx context.Context, id, companyID uuid.UUID, params CreateJobParams) (*entities.JobForUpdate, error)
```

`Search`, `GetByID`, `GetForUpdate`, `Update` are unchanged.

---

## 4. Application layer

### 4.1 Input DTO — `application/dtos/createJobDto.go` (NEW) — D6

The handler decodes the request body **directly into this DTO**. Unknown keys (`id`, `company_id`, `status`, `created_at`, `updated_at`, `published_at`, `deleted_at`, `search_vector`) are silently dropped by `encoding/json` — exactly the "ignored/immutable fields" behavior the spec pins. `company_id` is never declared (the middleware is the single source); no path id; no CAS header.

```go
type CreateJobDto struct {
	Title          string  `json:"title"`
	Description    string  `json:"description"`
	WorkMode       string  `json:"work_mode"`
	EmploymentType string  `json:"employment_type"`
	Seniority      string  `json:"seniority"`
	Location       *string `json:"location"`
	SalaryMin      *int    `json:"salary_min"`
	SalaryMax      *int    `json:"salary_max"`
	SalaryCurrency *string `json:"salary_currency"`
}
```

- Required fields are non-pointer `string`. Absent **and** JSON `null` both decode to `""` (no error), which the use case rejects as `ErrEmptyTitle`/`ErrEmptyDescription`. Unknown `work_mode`/`employment_type`/`seniority` are non-empty strings the use case rejects via `Parse*`.
- Optional fields are plain `*string`/`*int`. Absent and JSON `null` both decode to `nil` (no error), and both mean SQL NULL — there is **no** tri-state on create (no prior value to "clear"). `valueobjects.Optional[T]` is intentionally **not** reused (PATCH-only codec).
- `salary_currency` is `*string`; `nil → MXN` is resolved in the use case (D5).

A decode test (`TestCreateJobDto_DropsImmutableFields`) confirms `id`/`company_id`/`status` are silently dropped and the required/optional fields still decode.

### 4.2 Use case — `application/usecases/createJob.go` (NEW) — D8

```go
func (s *JobService) CreateJob(
	ctx context.Context,
	companyID uuid.UUID,
	in dtos.CreateJobDto,
) (*dtos.JobEditorViewDto, error)
```

Return contract: `(view, nil)` on success; `(nil, err)` otherwise. There is no CAS and no status transition — a new row has nothing to CAS against and is always born `draft`.

Exact, deterministic step order (validation short-circuits in this order, so a request with multiple errors surfaces the first — pinned for RED-first tests):

1. **Trim + non-empty** — `title := strings.TrimSpace(in.Title)`; empty → `ErrEmptyTitle`. `description := strings.TrimSpace(in.Description)`; empty → `ErrEmptyDescription`. (Mirrors PATCH's non-empty-first ordering in `EditJob`.)
2. **Parse required VOs** — `valueobjects.ParseWorkMode(in.WorkMode)` → `ErrInvalidWorkMode`; `ParseEmploymentType(in.EmploymentType)` → `ErrInvalidEmploymentType`; `ParseSeniority(in.Seniority)` → `ErrInvalidSeniority`.
3. **Parse optional `salary_currency` + default** — `cur := valueobjects.MXN`; if `in.SalaryCurrency != nil`, `cur, err = valueobjects.ParseSalaryCurrency(*in.SalaryCurrency)` → `ErrInvalidSalaryCurrency`. This single step is both the parse and the default resolution (D5).
4. **Salary range** — `if in.SalaryMin != nil && in.SalaryMax != nil && *in.SalaryMin > *in.SalaryMax` → `ErrInvalidSalaryRange`. A lone `salary_min` (or `salary_max`) is permitted (transient state; mirrors PATCH).
5. **Generate UUID v7** — `id, err := uuid.NewV7()`; error → propagate (500). No shared helper; same call as `entities.NewCompany`.
6. **Build params** — `repositories.CreateJobParams{Title: title, Description: description, WorkMode: wm, EmploymentType: et, Seniority: sn, Location: in.Location, SalaryMin: in.SalaryMin, SalaryMax: in.SalaryMax, SalaryCurrency: cur}`.
7. **`repo.Create`** — `row, err := s.repo.Create(ctx, id, companyID, params)`. `ErrCompanyNotActive` / `ErrCompanyGone` → propagate (HTTP 409); `ErrInvalidStatusTransition` → propagate (HTTP 400, defense-in-depth); other → propagate (500). There is nothing to pre-read for CAS.
8. **Project** — `return toEditorView(row), nil` (reuses the package-private `toEditorView` from `updateJob.go` verbatim).

### 4.3 Service surface — `application/usecases/jobService.go` (MOD)

`NewJobService` signature is unchanged (the repo port is the only constructor argument). Add the method and declare the use-case seam next to `EditJob`:

```go
var _ EditJob = (*JobService)(nil)
var _ CreateJobUseCase = (*JobService)(nil)

type CreateJobUseCase interface {
	CreateJob(ctx context.Context, companyID uuid.UUID, in dtos.CreateJobDto) (*dtos.JobEditorViewDto, error)
}
```

---

## 5. Persistence (sqlc)

### 5.1 `CreateJob :one` — `backend/db/queries/jobs.sql` (MOD) — D1/D2/D3

The atomic guard and the editor-view projection are one statement, one round trip:

```sql
-- name: CreateJob :one
-- Atomic create for POST /jobs (design D1/D2/D3).
--
-- Two guarantees live in this single statement:
--   1. Active-company gate: the `active` CTE selects the owning company
--      ONLY when status='active'. A suspended / pending_verification /
--      missing company yields zero rows in `active`, so `ins` inserts
--      zero rows and the final SELECT returns zero rows → the adapter maps
--      pgx.ErrNoRows → entities.ErrCompanyNotActive (the predicate and the
--      write are the same statement — no TOCTOU window).
--   2. Single-round-trip editor view: the final SELECT joins `ins` back to
--      `active` to carry company_name, so the output column set is EXACTLY
--      the GetJobForUpdate column set and the adapter reuses
--      toJobForUpdateEntity via a thin row lift.
--
-- status is written explicitly as 'draft' (locked decision #1): the row is
-- born hidden from the public read path (status='published' predicate) and
-- the explicit value is immune to a future DEFAULT drift.
--
-- salary_currency is always supplied by the use case (nil → MXN in Go), so
-- it is a required arg, never NULL. location / salary_min / salary_max are
-- nullable (sqlc.narg).
--
-- search_vector (STORED generated) is EXCLUDED from BOTH the INSERT column
-- list and every output list — a `RETURNING *` would map tsvector to
-- interface{} and a generated column rejects explicit writes (D3).
WITH active AS (
    SELECT id, name
    FROM companies
    WHERE id = sqlc.arg('company_id')::uuid
      AND status = 'active'
),
ins AS (
    INSERT INTO jobs (
        id, company_id, title, description, work_mode, employment_type,
        seniority, status, location, salary_min, salary_max, salary_currency
    )
    SELECT
        sqlc.arg('id')::uuid,
        active.id,
        sqlc.arg('title')::text,
        sqlc.arg('description')::text,
        sqlc.arg('work_mode')::text,
        sqlc.arg('employment_type')::text,
        sqlc.arg('seniority')::text,
        'draft',
        sqlc.narg('location')::text,
        sqlc.narg('salary_min')::int,
        sqlc.narg('salary_max')::int,
        sqlc.arg('salary_currency')::text
    FROM active
    RETURNING
        id, title, description, location, work_mode, employment_type,
        seniority, salary_min, salary_max, salary_currency, status,
        published_at, updated_at, company_id
)
SELECT
    ins.id,
    ins.title,
    ins.description,
    ins.location,
    ins.work_mode,
    ins.employment_type,
    ins.seniority,
    ins.salary_min,
    ins.salary_max,
    ins.salary_currency,
    ins.status,
    ins.published_at,
    ins.updated_at,
    ins.company_id,
    active.name AS company_name
FROM ins
JOIN active ON active.id = ins.company_id;
```

**D1 rationale (CTE over `WHERE EXISTS` / scalar subquery / plain INSERT):**

- The locked decision is an **atomic SQL guard**, so the "plain INSERT + use-case pre-check" alternative is out (TOCTOU).
- A `WHERE EXISTS (SELECT 1 FROM companies WHERE id=$company_id AND status='active')` guard would satisfy atomicity but does **not** carry `company.name`; the editor view embeds `{company:{id,name}}`, so the EXISTS form would need a second round trip or a fragile scalar subquery in `RETURNING`. The CTE `active` carries `name` naturally and is joined in the final SELECT.
- A scalar subquery in `RETURNING` (`(SELECT name FROM companies WHERE id=$company_id)`) is rejected: Postgres `RETURNING` expressions are scoped to the target table's columns and cannot reference CTE/other-table columns the way the final SELECT can; relying on it would be fragile and harder to reason about.
- **0 rows → `ErrCompanyNotActive`**: `CreateJob` is `:one`; when `active` is empty the final SELECT returns zero rows and sqlc's `QueryRow.Scan` surfaces `pgx.ErrNoRows`, which `mapCreateError` translates to `entities.ErrCompanyNotActive`. There is no `ErrJobNotFound` on this path — the row never existed.

**D2 (column set + entity mapping):** the output columns are exactly `GetJobForUpdateRow`'s 15 columns (`id, title, description, location, work_mode, employment_type, seniority, salary_min, salary_max, salary_currency, status, published_at, updated_at, company_id, company_name`). All are producible by a single `INSERT … RETURNING … JOIN`:

- `id, title, description, work_mode, employment_type, seniority, salary_currency` — explicit VALUES/SELECT inputs.
- `status` — the literal `'draft'`.
- `location, salary_min, salary_max` — nullable inputs (NULL → `pgtype.*{Valid:false}`).
- `published_at` — NULL for a draft (not written).
- `updated_at` — DB `now()` default, returned via `RETURNING updated_at`.
- `company_id` — `active.id` written as `jobs.company_id`, returned via `RETURNING company_id`.
- `company_name` — `active.name` via the final `JOIN active`.

sqlc emits a **distinct** `CreateJobRow` type (sqlc always emits per-query row types, even for identical column lists), so the adapter adds a thin lift `createRowToGetForUpdateRow` (mirroring the existing `getByIDToSearchRow`) and then reuses `toJobForUpdateEntity` verbatim. No parallel projection, no `entities.CreatedJob`.

**D3 (search_vector hard rule):** the INSERT column list and every output list are explicit and exclude `search_vector`. `RETURNING *` is forbidden here — it would (a) attempt to write the STORED generated column (which Postgres rejects) and (b) make sqlc map `tsvector` to `interface{}`. This mirrors the existing explicit-column-list convention in `SearchJobs`/`GetJobByID`/`GetJobForUpdate`.

### 5.2 Regen

`backend/internal/db/jobs.sql.go` is regenerated via `go tool sqlc generate` (never hand-edited). It gains `CreateJobParams` (fields named from the `sqlc.arg`/`sqlc.narg` names: `CompanyID uuid.UUID`, `ID uuid.UUID`, `Title string`, `Description string`, `WorkMode string`, `EmploymentType string`, `Seniority string`, `Location pgtype.Text`, `SalaryMin pgtype.Int4`, `SalaryMax pgtype.Int4`, `SalaryCurrency string`), `CreateJobRow`, and `CreateJob(ctx, arg CreateJobParams) (CreateJobRow, error)`. The existing four queries are unchanged. The exact generated field order is confirmed at regen time (RED for the SQL is the build-tagged integration test; the compile break from the port extension is the RED for the stubs).

---

## 6. Infrastructure

### 6.1 Postgres adapter — `infrastructure/postgres/jobRepository.go` (MOD) — D7

The `var _ repositories.JobRepository = (*JobRepository)(nil)` compile-time assertion is **unchanged** — adding `Create` to the concrete type keeps it valid. `NewJobRepository` is unchanged (still `*db.Queries`; the CTE is a single statement, no explicit transaction, no `pgxpool.Pool` needed).

```go
func (r *JobRepository) Create(ctx context.Context, id, companyID uuid.UUID, params repositories.CreateJobParams) (*entities.JobForUpdate, error) {
	row, err := r.queries.CreateJob(ctx, buildCreateJobParams(id, companyID, params))
	if err != nil {
		return nil, mapCreateError(err)
	}
	j, err := toJobForUpdateEntity(createRowToGetForUpdateRow(row))
	if err != nil {
		return nil, err
	}
	return &j, nil
}
```

**`mapCreateError`** (new, distinct from `mapUpdateError` — mirrors the companies `mapCompanyCreateError` precedent of a create-specific dispatcher):

```go
func mapCreateError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrCompanyNotActive // 0 rows on the active guard
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503": // foreign_key_violation on jobs.company_id
			return entities.ErrCompanyGone
		case "23514": // check_violation (work_mode/employment_type/seniority/salary_currency/status)
			return entities.ErrInvalidStatusTransition
		}
	}
	return err
}
```

- `pgx.ErrNoRows → ErrCompanyNotActive` is the designed path: 0 rows means the `active` CTE matched no company (non-active, or defensively missing).
- `23503 → ErrCompanyGone` and `23514 → ErrInvalidStatusTransition` are defense-in-depth (unreachable via the designed flow: the guard filters to existing active companies, and the use case parses VOs before SQL).
- **No `23505`** (no unique business key beyond the app-generated UUID v7 PK — locked decision #4).

**`buildCreateJobParams`**:

```go
func buildCreateJobParams(id, companyID uuid.UUID, p repositories.CreateJobParams) db.CreateJobParams {
	return db.CreateJobParams{
		CompanyID:      companyID,
		ID:             id,
		Title:          p.Title,
		Description:    p.Description,
		WorkMode:       p.WorkMode.String(),
		EmploymentType: p.EmploymentType.String(),
		Seniority:      p.Seniority.String(),
		Location:       strPtrToText(p.Location),
		SalaryMin:      intPtrToInt4(p.SalaryMin),
		SalaryMax:      intPtrToInt4(p.SalaryMax),
		SalaryCurrency: p.SalaryCurrency.String(),
	}
}
```

New helpers (the adapter already has `strPtrToText` and `pgInt4ToIntPtr`; it lacks the `*int → pgtype.Int4` direction):

```go
func intPtrToInt4(v *int) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(*v), Valid: true}
}

func createRowToGetForUpdateRow(row db.CreateJobRow) db.GetJobForUpdateRow {
	return db.GetJobForUpdateRow{
		ID:             row.ID,
		Title:          row.Title,
		Description:    row.Description,
		Location:       row.Location,
		WorkMode:       row.WorkMode,
		EmploymentType: row.EmploymentType,
		Seniority:      row.Seniority,
		SalaryMin:      row.SalaryMin,
		SalaryMax:      row.SalaryMax,
		SalaryCurrency: row.SalaryCurrency,
		Status:         row.Status,
		PublishedAt:    row.PublishedAt,
		UpdatedAt:      row.UpdatedAt,
		CompanyID:      row.CompanyID,
		CompanyName:    row.CompanyName,
	}
}
```

### 6.2 HTTP handler — `infrastructure/http/jobHandler.go` (MOD) — D9

`JobHandlers` gains `CreateJob http.HandlerFunc`; the accessor adds `CreateJob: http.HandlerFunc(h.createJob)`. The public `Routes()` mount remains GET-only (unchanged).

```go
func (h *JobHandler) createJob(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r) // fail-closed 500 if absent
	if !ok {
		return
	}
	var in dtos.CreateJobDto
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	view, err := h.service.CreateJob(r.Context(), cc.CompanyID, in)
	if err != nil {
		h.classifyAndWriteError(w, r, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusCreated, view)
}
```

- No path `{id}` parse, no `If-Unmodified-Since` parse — create has no CAS.
- `company_id` comes exclusively from `requireCompanyContext` (the `CompanyContext` the middleware injected); the DTO has no `company_id` field, so any body value is silently dropped.

`classifyError` gains two branches (placed before the default; `ErrInvalidStatusTransition` already maps 400):

```go
case errors.Is(err, entities.ErrCompanyNotActive):
	return http.StatusConflict, "company is not active"
case errors.Is(err, entities.ErrCompanyGone):
	return http.StatusConflict, "company is gone"
```

Both map to 409: the caller is already an admitted member (`RequireCompanyRole` resolved a real membership), so the reject is a server-side company-state conflict — never 403 (membership is fine) and never 404 (would leak company/row existence). `ErrCompanyGone` is unreachable and shares the 409 class with `ErrCompanyNotActive`.

### 6.3 Composition root — `cmd/api/main.go` (MOD) — D9

Add one line next to the existing gated PATCH (both `requireAuth` and `requireRecruiter` are already hoisted at `run()` scope):

```go
r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", jobHandlers.UpdateJob)
r.With(requireAuth, requireRecruiter).Post("/jobs", jobHandlers.CreateJob)
```

The public `r.Mount("/jobs", jobHandler.Routes())` MUST NOT gain POST. The per-method `JobHandlers()` accessor + the explicit gated `Post(...)` line is the structural guarantee (same routing-split defense as PATCH).

---

## 7. Sequence diagram — `CreateJob` flow

```mermaid
sequenceDiagram
    participant C as Client
    participant MW as RequireAuth + RequireCompanyRole
    participant H as createJob (HTTP)
    participant UC as CreateJob (usecase)
    participant R as JobRepository (postgres)
    participant DB as PostgreSQL

    C->>MW: POST /jobs (Bearer token, JSON body)
    MW->>MW: verify JWT (401) · resolve membership + role (403) · inject CompanyContext
    MW->>H: (CompanyContext present)

    H->>H: requireCompanyContext (500 if absent) · decode CreateJobDto (400 if malformed)
    H->>UC: CreateJob(ctx, companyID, dto)

    UC->>UC: 1. trim + non-empty title/description
    alt empty title/description
        UC-->>H: (nil, ErrEmptyTitle/ErrEmptyDescription)
        H-->>C: 400 <field-naming message>
    end
    UC->>UC: 2. parse work_mode/employment_type/seniority
    alt unknown VO
        UC-->>H: (nil, ErrInvalid*)
        H-->>C: 400 invalid <vo_name>
    end
    UC->>UC: 3. parse salary_currency; nil → MXN
    UC->>UC: 4. salary_min <= salary_max when both present
    alt salary_min > salary_max
        UC-->>H: (nil, ErrInvalidSalaryRange)
        H-->>C: 400 salary range message
    end
    UC->>UC: 5. id := uuid.NewV7()
    UC->>UC: 6. build repositories.CreateJobParams
    UC->>R: Create(ctx, id, companyID, params)
    R->>DB: WITH active AS (… status='active') INSERT … SELECT … FROM active RETURNING … JOIN active
    alt 0 rows (non-active / missing company)
        DB-->>R: pgx.ErrNoRows
        R-->>UC: ErrCompanyNotActive
        UC-->>H: (nil, ErrCompanyNotActive)
        H-->>C: 409 {"error":"company is not active"}
    else SQL error (23503/23514/other)
        DB-->>R: PgError / other
        R-->>UC: ErrCompanyGone | ErrInvalidStatusTransition | error
        UC-->>H: (nil, err)
        H-->>C: 409 | 400 | 500 (classifyError)
    else 1 row
        DB-->>R: CreateJobRow
        R-->>UC: *entities.JobForUpdate
        UC->>UC: 8. toEditorView(row)
        UC-->>H: (view, nil)
        H-->>C: 201 + JobEditorViewDto (status="draft", updated_at=now())
    end
```

---

## 8. Error taxonomy (HTTP)

| Outcome | Status | Body |
|---|---|---|
| Body is not valid JSON | 400 | `{"error":"invalid JSON body"}` |
| Empty `title` / `description` (after trim) | 400 | `{"error":"title must not be empty"}` / `{"error":"description must not be empty"}` |
| Unknown `work_mode` / `employment_type` / `seniority` / `salary_currency` | 400 | `{"error":"invalid <vo_name>"}` |
| `salary_min > salary_max` (both present) | 400 | `{"error":"salary_min must be less than or equal to salary_max"}` |
| No/invalid `Authorization` | 401 | (RequireAuth short-circuit) |
| Not a member / role below `recruiter` | 403 | (RequireCompanyRole short-circuit) |
| Missing `CompanyContext` reaching the handler | 500 | `{"error":"internal server error"}` |
| Owning company not `active` (0 rows on guard) | 409 | `{"error":"company is not active"}` |
| `ErrCompanyGone` (23503, defense-in-depth) | 409 | `{"error":"company is gone"}` |
| `ErrInvalidStatusTransition` (23514, defense-in-depth) | 400 | `{"error":"invalid status transition"}` |
| Anything else | 500 | `{"error":"internal server error"}` (real error logged at `slog.Error`) |

No `404` is produced by create — the row never existed and `company_id` is fixed by `CompanyContext` (no cross-company lookup), so the classification must not leak company/row existence.

---

## 9. Stub repair inventory (port extension breaks these atomically)

Adding `Create` to `repositories.JobRepository` breaks compilation of **every** type that satisfies the port. There are **five** (not three) in the current tree; all MUST gain a `Create` method in the same RED step (the compile error is the RED):

| Stub | File | Assertion |
|---|---|---|
| `stubJobRepo` | `domain/repositories/jobRepository_test.go` | `var repo JobRepository = &stubJobRepo{}` |
| `stubJobRepository` | `application/usecases/searchJobs_test.go` | `var _ repositories.JobRepository = (*stubJobRepository)(nil)` |
| `stubRepo` | `infrastructure/http/handler_test.go` | `var _ repositories.JobRepository = (*stubRepo)(nil)` |
| `writeStubRepo` | `application/usecases/updateJob_test.go` | `var _ repositories.JobRepository = (*writeStubRepo)(nil)` |
| `writeStubHandlerRepo` | `infrastructure/http/updateJobHandler_test.go` | `var _ repositories.JobRepository = (*writeStubHandlerRepo)(nil)` |

Each gains a default `Create` stub (`return nil, entities.ErrCompanyNotActive` or a programmable field, matching the file's existing stub style). The concrete `postgres.JobRepository` already satisfies the port (the `var _` assertion remains valid after its `Create` is added).

---

## 10. Tests plan (RED-first sketch for the tasks phase)

Strict TDD applies (`strict_tdd: true`). Order: RED → GREEN per behavior; the port-extension compile break is itself the RED for the stubs.

1. **Unit — DTO decode** (`application/dtos/createJobDto_test.go`): `CreateJobDto` decodes required strings + optional pointers; unknown keys `id`/`company_id`/`status`/`created_at`/`updated_at`/`published_at`/`deleted_at`/`search_vector` are silently dropped; absent vs JSON-`null` on optional fields both → `nil`; wrong type (`salary_min:"abc"`) → decode error (handler 400).
2. **Unit — salary_currency default** (`application/usecases/createJob_test.go`): `CreateJobDto{SalaryCurrency:nil}` → use case forwards `SalaryCurrency: valueobjects.MXN` to the stub repo; `SalaryCurrency:"USD"` → forwards USD; `SalaryCurrency:"EUR"` → `ErrInvalidSalaryCurrency`.
3. **Unit — use case steps** (`CreateJob` with a stub repo): empty title → `ErrEmptyTitle`; empty description → `ErrEmptyDescription`; unknown `work_mode`/`employment_type`/`seniority` → matching `ErrInvalid*`; `salary_min > salary_max` (both present) → `ErrInvalidSalaryRange`; salary-min-only and salary-max-only → proceed; success → `repo.Create` called with a UUID v7 (non-nil, version 7) and the parsed VOs, then `toEditorView` returns `status="draft"`; `repo.Create` returns `ErrCompanyNotActive` → use case propagates it.
4. **Unit — adapter helpers** (`infrastructure/postgres/jobRepository_test.go`): `buildCreateJobParams` (VO → canonical strings; optional pointers → valid/invalid pgtypes; `salary_currency` always valid); `intPtrToInt4` (nil → invalid, value → valid); `createRowToGetForUpdateRow` (field-for-field); `mapCreateError` (synthetic `pgconn.PgError{Code:"23503"} → `ErrCompanyGone`, `"23514"` → `ErrInvalidStatusTransition`, unknown → pass-through; `pgx.ErrNoRows` → `ErrCompanyNotActive`; no `23505` branch).
5. **Handler tests** (`infrastructure/http/createJobHandler_test.go`): 201 + editor view on success (decode body as `JobEditorViewDto`, assert `status="draft"`); 409 on `ErrCompanyNotActive`; 400 on malformed JSON / empty title / unknown VO / salary range; 500 on missing `CompanyContext` (no injected context); 401 no-`Authorization` (mount `RequireAuth` with a deny verifier ahead of the handler); 403 non-member is a middleware concern (covered by the gate tests / existing `RequireCompanyRole` tests); `company_id` in body ignored (stub records the `CompanyContext` id, not the body id).
6. **Integration — SQL** (`infrastructure/postgres/jobRepository_create_integration_test.go`, `//go:build integration`): active company creates a draft row (re-read `GetForUpdate` → `status='draft'`, `published_at IS NULL`, `updated_at` set); suspended and pending_verification companies → 0 rows → `ErrCompanyNotActive`; `search_vector` auto-populated (query `jobs.search_vector IS NOT NULL`) and NOT present in any RETURNING/row; created `id` is UUID v7 (version nibble); `salary_currency` defaults to `MXN` when omitted in the DTO; `RETURNING` does not include `search_vector` (assert by the row type not having a `SearchVector` field / by the query round-tripping without a tsvector scan error).

---

## 11. Out of scope (explicit)

- **No migration**, no schema hardening (non-empty title/description and `salary_min <= salary_max` stay domain-enforced).
- No dedupe, no draft-count limit, no `status` in the request body, no notifications/events.
- No public read change (`GET /jobs` / `GET /jobs/{id}` / `SearchJobsItem` unchanged).
- No `Optional[T]` on create (plain pointers), no `entities.NewJob` factory.

---

## 12. Risks and rollout

- **Routing split**: mitigated by the per-method `JobHandlers()` accessor + the explicit `r.With(requireAuth, requireRecruiter).Post("/jobs", …)` line; a handler test asserts no-`Authorization` → 401 and the public mount does not serve POST.
- **Company-id injection**: the DTO has no `company_id` field; `encoding/json` drops it; the middleware is the single source. A decode test + handler test pin this.
- **Active-company race**: eliminated by the single-statement CTE guard (no check-then-write sequence exists).
- **`search_vector` write attempt**: the explicit column list + explicit RETURNING/SELECT lists make a `RETURNING *` impossible to slip in silently; the integration test pins auto-population without explicit write.
- **sqlc CTE shape**: the nested `WITH … INSERT … RETURNING … SELECT` is a supported `:one` pattern; the exact `CreateJobRow` field set is verified at `go tool sqlc generate` time (the adapter's `createRowToGetForUpdateRow` will fail to compile if sqlc emits a different order/name).
- **Rollback**: revert the merge commit — no migration, no schema change, no new package; reverting `main.go` removes the route while public GETs and gated PATCH keep working.

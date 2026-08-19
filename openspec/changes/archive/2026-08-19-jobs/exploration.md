# Exploration — `jobs` (vacantes)

> Date: 2026-08-19 · Status: complete (read-only investigation)

## Context

New bounded context `jobs` (job postings / vacantes) for `peopleflow-vacantes`.
Headline from `docs/ROADMAP.md`: **vacantes con búsqueda full-text** (`search_vector`),
business rule **"solo empresa `active` publica"**.

## 1. Auth / identity facts

- `RequireAuth` yields `security.Claims{ Subject string; Groups []string }` — the entire token surface.
  `Subject` = JWT `sub` = `users.cognito_sub`; `Groups` = `cognito:groups`.
- **No** `company_id`, `user_type`, or role claim in the token. `users.user_type`
  (`candidate` | `recruiter`) lives only in Postgres, not the JWT.
- `cognito:groups` is captured by the middleware but never consumed for authorization.
- Reusable IDOR-resistant pattern: `resolveUserID(ctx, sub)` resolves `cognito_sub → users.id`
  at the use-case edge (see `candidates` slice); unknown sub → `ErrUnknownSubject` → 401.

## 2. Company ownership gap (the key finding)

- No `company_members` / `invitations` table (migrations stop at `00006`). Zero references
  to `company_id` / membership / ownership in code.
- `companies.created_by` / owner is absent — `POST /companies` is public/unauthed; companies
  are born ownerless.
- Net: **there is no way today to answer "which company does this authenticated user belong to".**

Approaches compared:

1. **Minimal `company_members` slice** — preferred prerequisite whenever the write side ships.
   `company_members (id UUID PK, company_id FK→companies, user_id FK→users UNIQUE, role CHECK(owner|recruiter))`.
   Lives in the `companies` feature (per architecture doc), not `jobs`. `UNIQUE(user_id)`
   enforces "one company per user" (already the recorded decision).
2. **Explicit `company_id` in request body** — REJECTED (IDOR/spoofing footgun; contradicts the
   codebase's own IDOR discipline).
3. **Public-read first, write side deferred** — recommended MVP sequencing (chosen).

## 3. Full-text search recommendation

- **`tsvector`/`tsquery` + GIN index on a STORED generated column** — NOT `pg_trgm`.
  This is already the in-repo pattern (`candidate_profiles.search_vector` in `00006`).
- `pg_trgm` is for substring/fuzzy (`%x%`), which is not what job keyword search is.
- sqlc gotcha: `tsvector` maps to `interface{}` in generated code. For list queries, list the
  SELECT columns explicitly so `search_vector` never appears in the scan (or tolerate the
  `interface{}` field as `candidates` does).
- Query shape: `websearch_to_tsquery('spanish', $1)` — safe parser for raw user text (never
  throws syntax errors), then `search_vector @@ q` + `ts_rank` ordering.

## 4. Data-model sketch (updated: born `draft` per decision)

```sql
CREATE TABLE jobs (
    id              UUID PRIMARY KEY,                 -- app-generated uuid v7 (no default)
    company_id      UUID NOT NULL REFERENCES companies (id),
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    location        TEXT,                              -- optional (medium detail)
    work_mode       TEXT NOT NULL
        CONSTRAINT jobs_work_mode_check
        CHECK (work_mode IN ('onsite', 'remote', 'hybrid')),
    employment_type TEXT NOT NULL
        CONSTRAINT jobs_employment_type_check
        CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship')),
    seniority       TEXT NOT NULL
        CONSTRAINT jobs_seniority_check
        CHECK (seniority IN ('intern', 'junior', 'mid', 'senior', 'lead')),
    salary_min      INTEGER,                           -- optional
    salary_max      INTEGER,                           -- optional
    salary_currency TEXT DEFAULT 'MXN',
    status          TEXT NOT NULL DEFAULT 'draft'      -- born draft (decision)
        CONSTRAINT jobs_status_check
        CHECK (status IN ('draft', 'published', 'closed')),
    published_at    TIMESTAMPTZ,                       -- set on publish (deferred flow)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    search_vector   tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(description, '')), 'B')
    ) STORED
);

CREATE INDEX jobs_search_idx         ON jobs USING GIN (search_vector);
CREATE INDEX jobs_company_id_idx     ON jobs (company_id);
CREATE INDEX jobs_public_listing_idx ON jobs (published_at DESC)
    WHERE status = 'published' AND deleted_at IS NULL;
```

Notes:

- `created_by FK→users` is intentionally OMITTED from the read-only MVP (only needed for the write side).
- `draft` is the born state (decision); `published` is the searchable state; `closed` = manual takedown.
  The draft→publish→close *flow/endpoints* are deferred (see proposal).

## 5. Endpoint surface

**Public (this slice):**

| Endpoint | Purpose |
|---|---|
| `GET /jobs` | search/browse published jobs — `q` (full-text), `seniority`, `work_mode`, `location`, `employment_type`, pagination |
| `GET /jobs/{id}` | detail (published only) |

**Deferred (write side — not in this slice):**

| Endpoint | Needs |
|---|---|
| `POST /jobs`, `PUT /jobs/{id}`, close/publish, `GET /company/jobs` | `company_members` ownership + "company `active`" enforcement |

## 6. Reusable patterns (exact)

- **VO enum style** (`ParseXxx` + `String()` + sentinel `ErrInvalidXxx`, mirrored by named DB CHECK).
- **Entity + factory** (`NewXxx` validates VOs, `uuid.NewV7()`, `time.Now().UTC()`, optional `*T` pointers).
- **Repository port** (`domain/repositories/XxxRepository` + compile-time adapter assertion).
- **Postgres adapter** (`buildXxxParams` entity→sqlc params with `pgtype.Text`; `toEntity`; `mapCreateError` pgconn→domain).
- **Handler** (`XxxHandler{service}` + `Routes() chi.Router` + `classifyXxxError` + JSON helpers `internal/shared/httpjson`).
- **sqlc** (`-- name:` annotations, `RETURNING *`, `emit_json_tags`, `uuid→google/uuid` override; `make sqlc`).
- **Migrations** (goose Up/Down, named CHECKs, partial unique indexes, UUID PK no default, soft-delete `deleted_at`).

## 7. Decisions (resolved by Aldrich, 2026-08-19)

| Question | Decision |
|---|---|
| Scope (first slice) | **Public-read only** — `GET /jobs` + `GET /jobs/{id}`. Write side deferred. |
| Job lifecycle | **Born `draft`** — `draft → published → closed`; transition flow deferred. |
| Search language | **`'spanish'`** (matches `candidate_profiles`). |
| Field detail | **Medium** — title, description, work_mode, seniority, employment_type required; location + salary optional. |

Explicit deferrals (documented, to pick up later): write side (`POST/PUT /jobs` + publish/close flow),
`company_members` ownership slice, enforcement of "solo empresa `active` publica" on write,
frontend job board, seed data strategy for a populated job board in dev.

# ROADMAP — Estado y próximos pasos

> Archivo de continuidad. Si retomás el proyecto (esta u otra sesión/máquina), empezá leyendo esto.

## Dónde estamos

**Backend: walking skeleton vivo + 8 bounded contexts DELIVERED (`companies` incl. membership, `identity`, `candidates`, `jobs` incl. write-side, `applications`, `audit_events`, `company-membership`) + catálogo `industries`. Auth Cognito real (verifier RS256) montada en rutas autenticadas. Búsqueda full-text de vacantes viva. Lado escritura de empresas (owner-only) entregado.**

### Infraestructura base (lista y compilando)

- ✅ Módulo Go en `backend/go.mod` (módulo único; `api` y `workers` irán como binarios en `cmd/`).
- ✅ Herramientas pineadas con `go tool` (no global): goose v3.27.1, sqlc v1.31.1.
- ✅ `backend/docker-compose.yml`: Postgres **16** local con healthcheck (`pg_isready`).
- ✅ Migraciones goose aplicadas (versión 8): `00001_create_industries` (catálogo + 9 filas semilla), `00002_create_companies` (FK `industry_id`), `00003_companies_profile` (perfil rico, ~10 campos nullable), `00004_companies_active_default` (status nace `active` — decisión MVP), `00005_create_users` (puente Cognito), `00006_create_candidate_profiles` (+ `candidate_languages`), `00007_jobs` (vacantes + `search_vector`), `00008_jobs_seed` (dev-only).
- ✅ sqlc configurado (`backend/sqlc.yaml`: pgx/v5, override `uuid`→`google/uuid`) + código generado en `internal/db/`.
- ✅ Queries en `backend/db/queries/companies.sql`: `CreateCompany`, `GetCompanyByID`.
- ✅ Composition root `backend/cmd/api/main.go`: pool pgx + chi + `/healthz` (pinguea DB) + graceful shutdown. **Corre y responde 200.**

### Feature `companies` (arquitectura hexagonal — ✅ DELIVERED)

- ✅ **domain**: `entities.Company` + `NewCompany` (factory: arma VOs, genera UUID v7, status inicial `active` — sin verificación en el MVP, ver `docs/flujo-verificacion-empresas.md` —, timestamps) + `CompanyProfile` (perfil rico). Value objects: `CompanyName`, `CompanyRfc`, `CompanyStatus`, `CompanyDescription`, `CompanySize`, `FoundedYear`. `repositories.CompanyRepository` (puerto). Errores de dominio (`ErrCompanyNotFound`, `ErrEmptyIndustry`, `ErrDuplicateCompany`, `ErrIndustryNotFound`).
- ✅ **application**: `dtos.CreateCompanyDto` + `usecases.CompanyService` (`CreateCompany`, `GetCompanyByID`).
- ✅ **infrastructure**: repo Postgres (mapeo entidad↔sqlc) + handler HTTP + wiring en `main.go`.
- ✅ **Endpoints**: `POST /companies`, `GET /companies/{id}` (response redactado sin `rfc`/`status`). Escritura owner-only entregada (2026-08-26): `PATCH /me/company` (parcial + CAS) y `DELETE /me/company` (soft-delete + cierre transaccional de vacantes).
- ✅ **Perfil rico** (migración `00003`): `description`, `size` (TEXT+CHECK: startup/small/medium/large/enterprise), `founded_year` (SMALLINT+CHECK 1800–2200, regla autoritativa en el VO), `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`.
- ✅ **Error mapping pgconn**: SQLSTATE → sentinel de dominio → HTTP (23505→409 Conflict, 23503→400 Bad Request).
- ✅ **Tests**: 50 verdes (`go test ./... -count=1`), strict TDD. Build/vet/race limpios.
- 🔲 **Pendiente**: `UpdateCompany` / `DeleteCompany` (ya desbloqueados con `identity` — ver Deuda).

### Feature `identity` (✅ DELIVERED)

- ✅ Tabla `users` (migración `00005`), puente Cognito→Postgres vía `users.cognito_sub`. `ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING RETURNING ...` (idempotente, ready para la Lambda PostConfirmation).
- ✅ Dominio `User` + VOs (`Email`, `FullName`, `UserType`), repo Postgres con `mapCreateError`, use case `EnsureUser`/`GetUserByCognitoSub`.
- ✅ **Auth real**: verifier RS256 (`jwk.ParseKey` con `WithPEM` — PKCS#1 y PKIX) + middleware `RequireAuth` fail-closed.

### Feature `candidates` (✅ DELIVERED)

- ✅ Migración `00006`: `candidate_profiles` (1:1 con `users`) + `candidate_languages`.
- ✅ Dominio `CandidateProfile` + VOs (`EducationLevel`, `SalaryPeriod`, `CefrLevel`, `NormalizeSkills`), use cases self-service (`GetMyProfile`/`UpsertMyProfile`/`ReplaceMyLanguages`/`ListMyLanguages` con resolución `cognito_sub → users.id`).
- ✅ Endpoints autenticados: `GET/PUT /me/profile` + `/me/languages` (reemplazo atómico de idiomas en `pgx.Tx`).
- ✅ `RequireAuth` montado en `/me/*`. 21/21 tareas, verify PASS WITH WARNINGS (18/18 escenarios, 0 CRITICAL).

### Feature `jobs` (✅ DELIVERED — public-read slice)

- ✅ Migración `00007`: tabla `jobs` (`status` `draft/published/closed`, nace `draft`; `work_mode`/`employment_type`/`seniority`/`salary_currency` con CHECK; `search_vector` STORED generado + GIN + índices). `00008`: seed dev-only (3 empresas `active` + 6 vacantes `published`, idempotente).
- ✅ Búsqueda full-text `'spanish'` (`websearch_to_tsquery` + `ts_rank`) + filtros (`seniority`, `work_mode`, `employment_type`, `location`, `currency`) + paginación keyset 3-tuple `(ts_rank, published_at, id)`.
- ✅ Endpoints públicos: `GET /jobs` + `GET /jobs/{id}` — solo vacantes `published` de empresas `active` (regla "solo empresa `active` publica", en lectura).
- ✅ 36 tareas, verify PASS WITH WARNINGS (8/8 requisitos, 29/29 escenarios, 0 CRITICAL). Read-side con tests de integración (visibilidad/keyset/FTS/filtros, mutation-proven).

### Catálogo `industries` (✅)

- ✅ `GET /industries` — handler fino (sin ceremonia hexagonal; es catálogo de referencia, no bounded context). Helpers JSON en `internal/shared/httpjson`.

### Frontend

- ✅ Mockups HTML completos en `design/screens/` (job board, detalle, postulación wizard, dashboard empresa, logins, theming claro/oscuro).
- 🔲 `frontend/` (Next.js) vacío — sin código de app todavía.

### Infra / workers

- 🔲 `infra/` (Terraform) vacío. `workers/` vacío.

## QUÉ SIGUE (en orden de dependencias)

1. ✅ **Flujo de verificación de empresas (MVP)** — RESUELTO: las empresas nacen `active` (sin pipeline). Validación básica = `name`/`rfc`/`industry_id` + `rfc` único. `suspended` queda como takedown manual. El flujo avanzado (documentos, cola de aprobación, lookup RFC) queda DIFERIDO y documentado en `docs/flujo-verificacion-empresas.md`.
2. ✅ **`identity`** — DELIVERED. Puente Cognito→Postgres (`users.cognito_sub`) + verifier RS256 + `RequireAuth`. Desbloqueó todo lo autenticado.
3. ✅ **`candidates`** — DELIVERED. `candidate_profiles` (1:1 con `users`) + `candidate_languages` + self-service `/me/*`.
4. ✅ **`jobs`** — DELIVERED (public-read + write-side). Lectura con búsqueda full-text (`search_vector`). Escritura entregada en 3 ciclos: `jobs-create` (POST /jobs draft), `jobs-reopen` (CAS + transiciones), `jobs-soft-delete` (tombstone + read-side). Gate `RequireCompanyRole(recruiter)` vía `company_members`.
5. ✅ **`applications`** — DELIVERED. Postulaciones + pipeline del reclutador (apply + list + transition), `GET /me/applications` del candidato.
6. ✅ **`audit_events`** — DELIVERED. Append-only en los write paths de applications (co-write atómico fail-closed). Migración `00011`.
7. ✅ **`companies-write`** — DELIVERED (2026-08-26). `PATCH /me/company` (parcial + CAS If-Unmodified-Since, rfc/industry inmutables) y `DELETE /me/company` (soft-delete + cierre transaccional de vacantes), ambos owner-only. Spec canónica `companies` creada (9 req / 45 escenarios).
8. ✅ **`companies-audit`** — DELIVERED (2026-08-26). `CompanyUpdated`/`CompanyDeleted` emitidos desde los write paths owner-only de companies (co-write atómico fail-closed en el mismo `pgx.Tx`). Vocabulario de eventos cerrado expandido a 4 (audit_events); metadata PII-free (`CompanyUpdated` → `{}`, `CompanyDeleted` → `{jobs_closed}`).

Decisión abierta para discutir cuando toque: ¿quién valida que `industry_id` exista? Hoy lo garantiza el FK (DB). Evaluar si además se valida contra el catálogo activo en la capa de aplicación.

## Deuda técnica / Follow-ups (no perder de vista)

> Items chicos no-bloqueantes acumulados entre ciclos. Atacarlos cuando haya un hueco; no dejar que se pierdan.

- ✅ **`UpdateCompany` / `DeleteCompany`** — ENTREGADO (2026-08-26, `companies-write`): `PATCH/DELETE /me/company` owner-only, soft-delete + cierre transaccional de vacantes. Ownership resuelto: la empresa se edita/borra a sí misma vía `RequireCompanyRole(owner)`.
- ✅ **Escritura de `jobs`** — ENTREGADO (`jobs-create`/`jobs-reopen`/`jobs-soft-delete`).
- ✅ **`company_members`** — ENTREGADO (ciclo `company-members`): ownership de empresa + roles owner/recruiter, endpoints `/me/company/members`.
- 🔲 **Follow-ups de verify de `companies-write` (W1–W6, archivado)**: test live-DB de rollback del inline-close (hoy `t.Skip`); tests de CAS ausente/malformado en PATCH; assertion multi-campo en PATCH; test de carrera concurrente; paridad de redacción del body 409 de PATCH; pin de no-audit.
- 🔲 **Unificar idioma de strings de error** en `companies/` (hoy mezcla es/en).
- 🔲 **Cobertura `Create`/`GetByID` del repo `companies`** (requiere Postgres vivo — hoy solo hay unit tests con stub).
- 🔲 **Test de CHECK constraints a nivel DB** (además del VO) en `companies` (`size`, `founded_year`) — evidencia por `information_schema`, no inspección estática.
- 🔲 **Separar commits RED de GREEN** en ciclos futuros (práctica; hoy el TDD RED-first no es git-reconstruible).
- 🔲 **Frontend** (`Next.js`) — mockups HTML listos en `design/screens/`, sin código de app.
- 🔲 **Lambda PostConfirmation** de Cognito → `users` (el backend ya es idempotente para recibirla).
- ✅ **Audit events para companies** — ENTREGADO (2026-08-26, `companies-audit`): `CompanyUpdated`/`CompanyDeleted` co-escritos atómicamente desde `PATCH/DELETE /me/company`. Vocabulario cerrado de audit_events a 4 eventos.
- ✅ **Hardening read-side `c.deleted_at IS NULL`** en queries públicas de jobs (`SearchJobs` + `GetJobByID`) — ENTREGADO: el inline-close tapa la fuga del flujo de borrado; el predicado es defense-in-depth para un futuro code path que deje una vacante `published` con empresa tombstonada. Cubierto por tests de integración (Search + GetByID, fixture con empresa `active` + `deleted_at` seteado).
- 🔲 **Restore/undelete de empresa** — el mecanismo inverso del soft-delete (fuera de scope de `companies-write`).
- 🔲 **`infra/` (Terraform)** y **`workers/`** — vacíos.
- ✅ **Enforcement "empresa viva" en escritura** — ENTREGADO en dos capas complementarias: (a) los write paths de jobs (`CreateJob`, `UpdateJob`, `SoftDeleteJob`, `GetJobForUpdate`) y el apply gate de applications (`CreateApplication`) rechazan empresas tombstoned (`status='active'` + `deleted_at` seteado — `SoftDeleteCompany` preserva el status, así que `status='active'` solo no es gate de "empresa viva"). Jobs → `ErrCompanyNotActive` (409) / `ErrJobNotFound` en `GetJobForUpdate`; applications → `ErrJobNotApplicable` (404). Cubierto por tests de integración live-DB (fixture empresa active + tombstone + job published, RED→GREEN). Companion del hardening read-side (b59604c). (b) `RequireCompanyRole` endurecido con un gate de liveness de empresa (`require-company-role-tombstone-gate`): la middleware resuelve la membresía del sujeto y ANTES de comparar el rol sondea la liveness de la empresa (mismo predicado `deleted_at IS NULL` de `GetCompanyByID`); empresa tombstonada (`deleted_at IS NOT NULL`) o empresa inexistente (`ErrCompanyNotFound`) colapsan al MISMO `403 Forbidden` con reason `company is inactive`, el handler nunca corre y no se inyecta `CompanyContext`. Cubre TODA ruta role-gated: `POST /jobs`, `PATCH /jobs/{id}`, `DELETE /jobs/{id}`, `GET/PATCH /jobs/{jobId}/applications[/...]` (list / detail / transition), `PATCH /me/company`, `DELETE /me/company`, y las mutaciones de `company_members` (list / add / update / remove del subtree `/me/company/members`). No aplica a rutas `RequireAuth`-only: `GET /me/company` (R7-S3 devuelve `404 company not found`: `GetCompanyByID` filtra `deleted_at IS NULL`; la fila de membership sobrevive solo como historial en DB, sin archived-company response), `POST /jobs/{jobId}/applications` (apply candidato — sigue `404 job not applicable` si la JOB-empresa está tombstonada), `GET /me/applications`, `/me/profile`. Las guardas SQL del punto (a) se RETIENEN como defense-in-depth: un bypass o mis-wire de la middleware seguiría viendo `ErrCompanyNotActive` (409) / `ErrJobNotFound` (404) / `ErrJobNotApplicable` (404) según la ruta, pero la API de producción nunca alcanza esas status para empresa-miembro tombstonada (siempre `403 company is inactive` primero).
- 🔲 **Conversión FX de salarios** — hoy el filtro `currency` es match exacto (USD/MXN first-class), sin conversión.

## Stack decidido (no re-discutir)

- Router: **chi** | Datos: **sqlc + pgx/v5** | DI: **manual** | Migraciones: **goose**
- DB: PostgreSQL 16 | PK entidades: UUID v7 generado en Go (`google/uuid`) | PK catálogos: slug TEXT (ver §1.1 modelo de datos)

## Comandos útiles (recordatorio para máquina nueva)

Todo corre desde `backend/`. **No hay que exportar variables a mano** — viven en `backend/.env` (gitignored; `cp backend/.env.example backend/.env` la primera vez). Goose las auto-carga; el server las carga vía `godotenv`.

- **Herramientas**: pineadas en `go.mod` con `go tool` → NO hay que instalar goose/sqlc global. Solo necesitás **Go 1.26+** y **Docker**.
- DB: `make db-up` (baja: `make db-down`)
- Migrar: `make db-migrate` (status: `make db-status`)
- Regenerar sqlc: `make sqlc`
- Correr API: `make run` → probar `curl -i localhost:8080/healthz`
- Tests: `make test` (= `go test ./... -count=1`)
- Targets equivalentes sin Makefile: `go tool goose up`, `go tool goose status`, `go tool sqlc generate`, `go run ./cmd/api`, `go test ./... -count=1`.

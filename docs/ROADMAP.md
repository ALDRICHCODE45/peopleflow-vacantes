# ROADMAP — Estado y próximos pasos

> Archivo de continuidad. Si retomás el proyecto (esta u otra sesión/máquina), empezá leyendo esto.

## Dónde estamos

**Backend: walking skeleton vivo + 3 bounded contexts DELIVERED (`companies`, `identity`, `candidates`) + catálogo `industries`. Auth Cognito real (verifier RS256) montada en rutas autenticadas.**

### Infraestructura base (lista y compilando)

- ✅ Módulo Go en `backend/go.mod` (módulo único; `api` y `workers` irán como binarios en `cmd/`).
- ✅ Herramientas pineadas con `go tool` (no global): goose v3.27.1, sqlc v1.31.1.
- ✅ `backend/docker-compose.yml`: Postgres **16** local con healthcheck (`pg_isready`).
- ✅ Migraciones goose aplicadas (versión 6): `00001_create_industries` (catálogo + 9 filas semilla), `00002_create_companies` (FK `industry_id`), `00003_companies_profile` (perfil rico, ~10 campos nullable), `00004_companies_active_default` (status nace `active` — decisión MVP), `00005_create_users` (puente Cognito), `00006_create_candidate_profiles` (+ `candidate_languages`).
- ✅ sqlc configurado (`backend/sqlc.yaml`: pgx/v5, override `uuid`→`google/uuid`) + código generado en `internal/db/`.
- ✅ Queries en `backend/db/queries/companies.sql`: `CreateCompany`, `GetCompanyByID`.
- ✅ Composition root `backend/cmd/api/main.go`: pool pgx + chi + `/healthz` (pinguea DB) + graceful shutdown. **Corre y responde 200.**

### Feature `companies` (arquitectura hexagonal — ✅ DELIVERED)

- ✅ **domain**: `entities.Company` + `NewCompany` (factory: arma VOs, genera UUID v7, status inicial `active` — sin verificación en el MVP, ver `docs/flujo-verificacion-empresas.md` —, timestamps) + `CompanyProfile` (perfil rico). Value objects: `CompanyName`, `CompanyRfc`, `CompanyStatus`, `CompanyDescription`, `CompanySize`, `FoundedYear`. `repositories.CompanyRepository` (puerto). Errores de dominio (`ErrCompanyNotFound`, `ErrEmptyIndustry`, `ErrDuplicateCompany`, `ErrIndustryNotFound`).
- ✅ **application**: `dtos.CreateCompanyDto` + `usecases.CompanyService` (`CreateCompany`, `GetCompanyByID`).
- ✅ **infrastructure**: repo Postgres (mapeo entidad↔sqlc) + handler HTTP + wiring en `main.go`.
- ✅ **Endpoints**: `POST /companies`, `GET /companies/{id}` (response redactado sin `rfc`/`status`).
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
4. **`jobs`** — vacantes con búsqueda full-text (`search_vector`). Regla: "solo empresa `active` publica". ← **PRÓXIMO**
5. **`applications`** — postulaciones + pipeline del reclutador.
6. **`audit_events`** — append-only.

Decisión abierta para discutir cuando toque: ¿quién valida que `industry_id` exista? Hoy lo garantiza el FK (DB). Evaluar si además se valida contra el catálogo activo en la capa de aplicación.

## Deuda técnica / Follow-ups (no perder de vista)

> Items chicos no-bloqueantes acumulados entre ciclos. Atacarlos cuando haya un hueco; no dejar que se pierdan.

- 🔲 **Unificar idioma de strings de error** en `companies/` (hoy mezcla es/en).
- 🔲 **Cobertura `Create`/`GetByID` del repo `companies`** (requiere Postgres vivo — hoy solo hay unit tests con stub).
- 🔲 **Test de CHECK constraints a nivel DB** (además del VO) en `companies` (`size`, `founded_year`) — evidencia por `information_schema`, no inspección estática.
- 🔲 **`UpdateCompany` / `DeleteCompany`** — ahora desbloqueados con `identity`. Definir ownership: ¿la empresa se edita/borra a sí misma (claim `company_id` en el token) o lo hace un admin?
- 🔲 **Separar commits RED de GREEN** en ciclos futuros (práctica; hoy el TDD RED-first no es git-reconstruible).
- 🔲 **Frontend** (`Next.js`) — mockups HTML listos en `design/screens/`, sin código de app.
- 🔲 **Lambda PostConfirmation** de Cognito → `users` (el backend ya es idempotente para recibirla).
- 🔲 **`infra/` (Terraform)** y **`workers/`** — vacíos.

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

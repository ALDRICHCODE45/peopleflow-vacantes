# ROADMAP — Estado y próximos pasos

> Archivo de continuidad. Si retomás el proyecto (esta u otra sesión/máquina), empezá leyendo esto.

## Dónde estamos

**Backend: walking skeleton vivo + primera feature (`companies`) COMPLETA + catálogo `industries`.**

### Infraestructura base (lista y compilando)

- ✅ Módulo Go en `backend/go.mod` (módulo único; `api` y `workers` irán como binarios en `cmd/`).
- ✅ Herramientas pineadas con `go tool` (no global): goose v3.27.1, sqlc v1.31.1.
- ✅ `backend/docker-compose.yml`: Postgres **16** local con healthcheck (`pg_isready`).
- ✅ Migraciones goose aplicadas (versión 4): `00001_create_industries` (catálogo + 9 filas semilla), `00002_create_companies` (FK `industry_id`), `00003_companies_profile` (perfil rico, ~10 campos nullable), `00004_companies_active_default` (status nace `active` — decisión MVP).
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
- 🔲 **Pendiente**: `UpdateCompany` / `DeleteCompany` esperan el dominio `identity` (auth Cognito).

### Catálogo `industries` (✅)

- ✅ `GET /industries` — handler fino (sin ceremonia hexagonal; es catálogo de referencia, no bounded context). Helpers JSON en `internal/shared/httpjson`.

### Frontend

- ✅ Mockups HTML completos en `design/screens/` (job board, detalle, postulación wizard, dashboard empresa, logins, theming claro/oscuro).
- 🔲 `frontend/` (Next.js) vacío — sin código de app todavía.

### Infra / workers

- 🔲 `infra/` (Terraform) vacío. `workers/` vacío.

## QUÉ SIGUE (en orden de dependencias)

1. ✅ **Flujo de verificación de empresas (MVP)** — RESUELTO: las empresas nacen `active` (sin pipeline). Validación básica = `name`/`rfc`/`industry_id` + `rfc` único. `suspended` queda como takedown manual. El flujo avanzado (documentos, cola de aprobación, lookup RFC) queda DIFERIDO y documentado en `docs/flujo-verificacion-empresas.md`.
2. **`identity`** — puente Cognito→Postgres (`users.cognito_sub`, Lambda PostConfirmation). Desbloquea `UpdateCompany`/`DeleteCompany` y todo lo autenticado.
3. **`candidates`** — `candidate_profiles` (1:1 con `users`) + `candidate_languages`.
4. **`jobs`** — vacantes con búsqueda full-text (`search_vector`). Regla: "solo empresa `active` publica".
5. **`applications`** — postulaciones + pipeline del reclutador.
6. **`audit_events`** — append-only.

Decisión abierta para discutir cuando toque: ¿quién valida que `industry_id` exista? Hoy lo garantiza el FK (DB). Evaluar si además se valida contra el catálogo activo en la capa de aplicación.

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

# ROADMAP — Estado y próximos pasos

> Archivo de continuidad. Si retomás el proyecto (esta u otra sesión/máquina), empezá leyendo esto.

## Dónde estamos

**Backend: walking skeleton vivo + primera feature (`companies`) a medio camino.**

Infraestructura base (lista y compilando):

- ✅ Módulo Go en `backend/go.mod` (módulo único; `api` y `workers` irán como binarios en `cmd/`).
- ✅ Herramientas pineadas con `go tool` (no global): goose v3.27.1, sqlc v1.31.1.
- ✅ `backend/docker-compose.yml`: Postgres **16** local con healthcheck (`pg_isready`).
- ✅ Migraciones goose aplicadas (versión 2): `00001_create_industries` (catálogo + 9 filas semilla), `00002_create_companies` (con FK `industry_id`).
- ✅ sqlc configurado (`backend/sqlc.yaml`: pgx/v5, override `uuid`→`google/uuid`) + código generado en `internal/db/`.
- ✅ Queries en `backend/db/queries/companies.sql`: `CreateCompany`, `GetCompanyByID`.
- ✅ Composition root `backend/cmd/api/main.go`: pool pgx + chi + `/healthz` (pinguea DB) + graceful shutdown. **Corre y responde 200.**

Feature `companies` (arquitectura hexagonal):

- ✅ **domain**: `entities.Company` + `NewCompany` (factory: arma VOs, genera UUID v7, status inicial `pending_verification`, timestamps). Value objects: `CompanyName`, `CompanyRfc`, `CompanyStatus` (enum int). `repositories.CompanyRepository` (puerto). Errores de dominio (`ErrCompanyNotFound`, `ErrEmptyIndustry`).
- ✅ **application**: `dtos.CreateCompanyDto` + `usecases.CompanyService.CreateCompany` (DTO → entidad → repo).
- 🔲 **infrastructure**: FALTA (es el próximo paso).

## QUÉ SIGUE (próximo paso inmediato)

**Capa de infraestructura de la feature `companies`** — es donde se conecta todo lo ya construido (pool pgx, `db.New`, código sqlc, `pgtype`):

1. **Repo Postgres** (`internal/features/companies/infrastructure/postgres/`): implementa `repositories.CompanyRepository` envolviendo el `db.Queries` de sqlc. Acá vive el mapeo **entidad ↔ sqlc**: `company.Name.Value()` → params, `*string ↔ pgtype.Text`, `company.Status.String()`, `uuid.UUID`. El `GetByID` devuelve `entities.ErrCompanyNotFound` cuando no hay fila.
2. **Handlers HTTP** (`.../infrastructure/http/`): reciben JSON → arman `CreateCompanyDto` → llaman al use case → mapean la entidad a un **response DTO** (la entidad NO se serializa directo: los VOs tienen campo privado). Montados en chi.
3. **Wiring en `cmd/api/main.go`**: `db.New(pool)` → repo Postgres → `NewCompanyService(repo)` → handler → router. Reemplaza el `_ = db.New(pool)` actual.

Pendiente menor: query `ListActiveIndustries` para exponer el catálogo de industrias al frontend.

Decisión abierta para discutir cuando toque: ¿quién valida que `industry_id` exista? Hoy lo garantiza el FK (DB). Evaluar si además se valida contra el catálogo activo en la capa de aplicación.

## Stack decidido (no re-discutir)

- Router: **chi** | Datos: **sqlc + pgx/v5** | DI: **manual** | Migraciones: **goose**
- DB: PostgreSQL 16 | PK entidades: UUID v7 generado en Go (`google/uuid`) | PK catálogos: slug TEXT (ver §1.1 modelo de datos)

## Comandos útiles (recordatorio para máquina nueva)

- **Herramientas**: ya están pineadas en `go.mod` con `go tool` → NO hay que instalar goose/sqlc global. Solo necesitás **Go 1.26+** y **Docker**.
- Levantar DB: `cd backend && docker compose up -d`
- Variables goose (export una vez por terminal):
  - `export GOOSE_DRIVER=postgres`
  - `export GOOSE_DBSTRING="postgres://admin:secreto@localhost:5432/peopleflow_vacancies?sslmode=disable"`
  - `export GOOSE_MIGRATION_DIR=db/migrations`
- Migrar: `go tool goose up` (status: `go tool goose status`)
- Regenerar sqlc: `go tool sqlc generate`
- Correr API: `export DATABASE_URL="postgres://admin:secreto@localhost:5432/peopleflow_vacancies?sslmode=disable"` → `go run ./cmd/api` → probar `curl -i localhost:8080/healthz`

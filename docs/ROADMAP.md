# ROADMAP — Estado y próximos pasos

> Archivo de continuidad. Si retomás el proyecto (esta u otra sesión/máquina), empezá leyendo esto.

> ⚠️ **Continuidad — decisiones provisionales (2026-10-10):** hay alcances
> marcados como *temporales/provisionales* que **no** están entregados. Antes de
> trabajar en identidad, auth, *provisioning* o producción, consultá el registro
> vigente: [`docs/temporary-decisions.md`](temporary-decisions.md). Ese registro
> manda para el alcance temporal de identidad; **no** es la fuente total del
> estado del proyecto (este ROADMAP puede estar desactualizado en otras áreas).
> Guía de uso del bootstrap local temporal (TMP-IDENTITY-001, solo local, solo
> usuarios): [`docs/local-identity-bootstrap.md`](local-identity-bootstrap.md).

## Dónde estamos

**Backend: walking skeleton vivo + 7 features DELIVERED (`companies` incl. membership, `identity`, `candidates`, `jobs` incl. write-side, `applications`, `audit_events`, `industries`). Auth Cognito real montada en rutas autenticadas (**JWKS** en producción; PEM estático solo local/test). Búsqueda full-text de vacantes viva. Lado escritura de empresas (owner-only) entregado.**

### Infraestructura base (lista y compilando)

- ✅ Módulo Go en `backend/go.mod` (módulo único; `api`, `migrate`, `postconfirmation` y `archguard` ya viven como binarios en `cmd/`; los workers Go son `future/non-MVP`).
- ✅ Herramientas pineadas con `go tool` (no global): goose v3.27.1, sqlc v1.31.1.
- ✅ `backend/docker-compose.yml`: Postgres **16** local con healthcheck (`pg_isready`).
- ✅ Migraciones goose aplicadas (versión actual `00011`): `00001_create_industries` (catálogo + 9 filas semilla), `00002_create_companies` (FK `industry_id`), `00003_companies_profile` (perfil rico, ~10 campos nullable), `00004_companies_active_default` (status nace `active` — decisión MVP), `00005_create_users` (puente Cognito), `00006_create_candidate_profiles` (+ `candidate_languages`), `00007_jobs` (vacantes + `search_vector`), `00008_jobs_seed` (dev-only), `00009_create_company_members`, `00010_create_applications`, `00011_create_audit_events` (append-only).
- ✅ `cmd/migrate` — ejecutable propio: goose con las migraciones embebidas (`go:embed`), comandos `up`/`down`/`status`, fallo clasificado con código de salida 3.
- ✅ sqlc configurado (`backend/sqlc.yaml`: pgx/v5, override `uuid`→`google/uuid`) + código generado en `internal/db/`.
- ✅ Queries en `backend/db/queries/companies.sql`: `CreateCompany`, `GetCompanyByID`.
- ✅ Composition root `backend/cmd/api/main.go`: pool pgx + chi + `/healthz` (liveness del proceso, sin tocar la DB) + `/readyz` (readiness de DB; 503 con body seguro cuando no está lista) + graceful shutdown. **Corre y responde 200.**

### Feature `companies` (arquitectura hexagonal — ✅ DELIVERED)

- ✅ **domain**: `entities.Company` + `NewCompany` (factory: arma VOs, genera UUID v7, status inicial `active` — sin verificación en el MVP, ver `docs/flujo-verificacion-empresas.md` —, timestamps) + `CompanyProfile` (perfil rico). Value objects: `CompanyName`, `CompanyRfc`, `CompanyStatus`, `CompanyDescription`, `CompanySize`, `FoundedYear`. `repositories.CompanyRepository` (puerto). Errores de dominio (`ErrCompanyNotFound`, `ErrEmptyIndustry`, `ErrDuplicateCompany`, `ErrIndustryNotFound`).
- ✅ **application**: `dtos.CreateCompanyDto` + `usecases.CompanyService` (`CreateCompany`, `GetCompanyByID`).
- ✅ **infrastructure**: repo Postgres (mapeo entidad↔sqlc) + handler HTTP + wiring en `main.go`.
- ✅ **Endpoints**: `POST /companies`, `GET /companies/{id}` (response redactado sin `rfc`/`status`). Escritura owner-only entregada (2026-08-26): `PATCH /me/company` (parcial + CAS) y `DELETE /me/company` (soft-delete + cierre transaccional de vacantes).
- ✅ **Perfil rico** (migración `00003`): `description`, `size` (TEXT+CHECK: startup/small/medium/large/enterprise), `founded_year` (SMALLINT+CHECK 1800–2200, regla autoritativa en el VO), `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`.
- ✅ **Error mapping pgconn**: SQLSTATE → sentinel de dominio → HTTP (23505→409 Conflict, 23503→400 Bad Request).
- ✅ **Tests**: 50 verdes (`go test ./... -count=1`), strict TDD. Build/vet/race limpios.
- ✅ **`UpdateCompany` / `DeleteCompany`** — ENTREGADO (2026-08-26, `companies-write`): `PATCH /me/company` (parcial + CAS) y `DELETE /me/company` (soft-delete + cierre transaccional de vacantes), ambos owner-only.

### Feature `identity` (✅ DELIVERED)

- ✅ Tabla `users` (migración `00005`), puente Cognito→Postgres vía `users.cognito_sub`. `ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING RETURNING ...` (idempotente; lo consume el ejecutable `cmd/postconfirmation`).
- ✅ Dominio `User` + VOs (`Email`, `FullName`, `UserType`), repo Postgres con `mapCreateError`, use case `EnsureUser`/`GetUserByCognitoSub`.
- ✅ **Auth real**: verifier RS256 con **JWKS** de Cognito en producción (selección por `kid`, cache acotado, refresh de rotación) + modo PEM estático explícito solo local/test, y middleware `RequireAuth` fail-closed.

### Feature `candidates` (✅ DELIVERED)

- ✅ Migración `00006`: `candidate_profiles` (1:1 con `users`) + `candidate_languages`.
- ✅ Dominio `CandidateProfile` + VOs (`EducationLevel`, `SalaryPeriod`, `CefrLevel`, `NormalizeSkills`), use cases self-service (`GetMyProfile`/`UpsertMyProfile`/`ReplaceMyLanguages`/`ListMyLanguages` con resolución `cognito_sub → users.id`).
- ✅ Endpoints autenticados: `GET/PUT /me/profile` + `GET/PUT /me/profile/languages` (reemplazo atómico de idiomas en `pgx.Tx`).
- ✅ `RequireAuth` montado en `/me/*`. 21/21 tareas, verify PASS WITH WARNINGS (18/18 escenarios, 0 CRITICAL).

### Feature `jobs` (✅ DELIVERED — public-read + write-side)

- ✅ Migración `00007`: tabla `jobs` (`status` `draft/published/closed`, nace `draft`; `work_mode`/`employment_type`/`seniority`/`salary_currency` con CHECK; `search_vector` STORED generado + GIN + índices). `00008`: seed dev-only (3 empresas `active` + 6 vacantes `published`, idempotente).
- ✅ Búsqueda full-text `'spanish'` (`websearch_to_tsquery` + `ts_rank`) + filtros (`seniority`, `work_mode`, `employment_type`, `location`, `currency`) + paginación keyset 3-tuple `(ts_rank, published_at, id)`.
- ✅ Endpoints públicos: `GET /jobs` + `GET /jobs/{id}` — solo vacantes `published` de empresas `active` (regla "solo empresa `active` publica", en lectura).
- ✅ 36 tareas, verify PASS WITH WARNINGS (8/8 requisitos, 29/29 escenarios, 0 CRITICAL). Read-side con tests de integración (visibilidad/keyset/FTS/filtros, mutation-proven).

### Catálogo `industries` (✅)

- ✅ `GET /industries` — handler fino (sin ceremonia hexagonal; es catálogo de referencia, no bounded context). Helpers JSON en `internal/shared/httpjson`.

### Frontend

- ✅ Mockups HTML completos en `design/screens/` (job board, detalle, postulación wizard, dashboard empresa, logins, theming claro/oscuro).
- ✅ App Next.js 15 implementada en `frontend/`: espacios de candidato y empresa, vacantes públicas y constructor de sitios de empleo. Pendientes en `odd/tasks/frontend-backlog.md`.

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

✅ **Validación de `industry_id`** — RESUELTO (`atomic-active-sql-gate`): la creación de empresa exige que la industria exista **y** esté activa dentro de la misma sentencia/transacción SQL (sin ventana TOCTOU; las industrias inactivas no son seleccionables). El error estable es `industry_unavailable`.

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
- ✅ **Frontend** — app Next.js 15 implementada en `frontend/` (candidato, empresa, vacantes públicas y constructor de sitios de empleo); pendientes en `odd/tasks/frontend-backlog.md`.
- ✅ **PostConfirmation de Cognito** — ENTREGADO: ejecutable `cmd/postconfirmation` (adaptador del trigger PostConfirmation, errores propagados como fallo de Lambda) sobre el `PostConfirmationHandler` idempotente de `identity`.
- ✅ **Audit events para companies** — ENTREGADO (2026-08-26, `companies-audit`): `CompanyUpdated`/`CompanyDeleted` co-escritos atómicamente desde `PATCH/DELETE /me/company`. Vocabulario cerrado de audit_events a 4 eventos.
- ✅ **Hardening read-side `c.deleted_at IS NULL`** en queries públicas de jobs (`SearchJobs` + `GetJobByID`) — ENTREGADO: el inline-close tapa la fuga del flujo de borrado; el predicado es defense-in-depth para un futuro code path que deje una vacante `published` con empresa tombstonada. Cubierto por tests de integración (Search + GetByID, fixture con empresa `active` + `deleted_at` seteado).
- 🔲 **Restore/undelete de empresa** — el mecanismo inverso del soft-delete (fuera de scope de `companies-write`).
- 🔲 **`infra/` (Terraform)** y **`workers/`** — placeholders vacíos; pertenecen a la fase AWS `future/non-MVP`.
- ✅ **Enforcement "empresa viva" en escritura** — ENTREGADO en dos capas complementarias: (a) los write paths de jobs (`CreateJob`, `UpdateJob`, `SoftDeleteJob`, `GetJobForUpdate`) y el apply gate de applications (`CreateApplication`) rechazan empresas tombstoned (`status='active'` + `deleted_at` seteado — `SoftDeleteCompany` preserva el status, así que `status='active'` solo no es gate de "empresa viva"). Jobs → `ErrCompanyNotActive` (409) / `ErrJobNotFound` en `GetJobForUpdate`; applications → `ErrJobNotApplicable` (404). Cubierto por tests de integración live-DB (fixture empresa active + tombstone + job published, RED→GREEN). Companion del hardening read-side (b59604c). (b) `RequireCompanyRole` endurecido con un gate de liveness de empresa (`require-company-role-tombstone-gate`): la middleware resuelve la membresía del sujeto y ANTES de comparar el rol sondea la liveness de la empresa (mismo predicado `deleted_at IS NULL` de `GetCompanyByID`); empresa tombstonada (`deleted_at IS NOT NULL`) o empresa inexistente (`ErrCompanyNotFound`) colapsan al MISMO `403 Forbidden` con reason `company is inactive`, el handler nunca corre y no se inyecta `CompanyContext`. Cubre TODA ruta role-gated: `POST /jobs`, `PATCH /jobs/{id}`, `DELETE /jobs/{id}`, `GET/PATCH /jobs/{jobId}/applications[/...]` (list / detail / transition), `PATCH /me/company`, `DELETE /me/company`, y las mutaciones de `company_members` (list / add / update / remove del subtree `/me/company/members`). No aplica a rutas `RequireAuth`-only: `GET /me/company` (R7-S3 devuelve `404 company not found`: `GetCompanyByID` filtra `deleted_at IS NULL`; la fila de membership sobrevive solo como historial en DB, sin archived-company response), `POST /jobs/{jobId}/applications` (apply candidato — sigue `404 job not applicable` si la JOB-empresa está tombstonada), `GET /me/applications`, `/me/profile`. Las guardas SQL del punto (a) se RETIENEN como defense-in-depth: un bypass o mis-wire de la middleware seguiría viendo `ErrCompanyNotActive` (409) / `ErrJobNotFound` (404) / `ErrJobNotApplicable` (404) según la ruta, pero la API de producción nunca alcanza esas status para empresa-miembro tombstonada (siempre `403 company is inactive` primero).
- 🔲 **Conversión FX de salarios** — hoy el filtro `currency` es match exacto (USD/MXN first-class), sin conversión.

### Psicométricos (entregado 2026-10-30, pusheado) — pendientes

Feature completa en `main` (backend B1–B10 + frontend, rediseño, estados vacíos y claridad de competencias). Detalle e
historia en `odd/tasks/psychometric-tests-backend.md` (L1–L19) y `odd/tasks/psychometric-tests.md`.

**Antes de producción**
- 🔲 **`TRUSTED_PROXY_CIDRS`** con los rangos del ALB. Sin esa variable todos los candidatos detrás del ALB comparten su IP y el
  presupuesto de 600 pedidos / 10 min del limitador público. Agregarla también a `backend/.env.example` (el agente no pudo:
  ruta bloqueada por la política de seguridad).
- 🔲 **Aviso de consentimiento (D9)** — revisión legal y aprobación de redacción del aviso v1 antes de congelar el artefacto.
- 🔲 **Purga programada (E3)** — `cmd/psychometric-purge` es one-shot (dry run por defecto, `-execute` borra). Falta agendarlo
  (y sus credenciales) en la infraestructura.
- 🔲 **Emails e invitaciones/recordatorios por correo (E1–E2)** — hoy el reclutador copia el link; depende de la decisión de
  email (`docs/decision-email-provider.md`).

**Robustez / deuda técnica**
- 🔲 **Barrido O(n) del limitador al tope de claves** (`internal/runtime/ratelimit/assessment.go`, advertencia de revisión
  nativa R4-capacity-sweep): con las 100000 claves vivas, cada pedido que necesita una clave nueva recorre todo el mapa bajo
  el lock antes de responder 429. Memoria acotada, pero costo de CPU bajo ataque. Opción: barrer solo en el tick periódico
  o llevar un índice de vencimientos.
- 🔲 **Limitador distribuido** — hoy es en memoria y por instancia (acordado en el contrato como infraestructura posterior).
- 🔲 **B10 sin probar en vivo**: carreras purga vs. escritores reales (candidato respondiendo/terminando, empleador
  recomparando) — solo respaldadas por el orden de locks — y comparación directa contra la base en rutas no tocadas.
- 🔲 **Advertencias no bloqueantes de la revisión nativa**: `scoring/quality.go:85-92` (legibilidad); `application/profile/
  profile.go:162-166` (orden de validación); `cmd/api/psychometric_invitations_flow_integration_test.go:106` (aserción de
  retención del 29 de febrero); `application/assessment/assessment.go:56-85` (cobertura de rechazos del decodificador).
- 🔲 **`cmd/api` escucha en todas las interfaces** (`":"+PORT`), no solo loopback — revisar para entornos locales/QA.

**Herramientas / proceso**
- 🔲 **Lineage de revisión nativa abierto** `review-18379eb5092e0e95` (B8c `3bd9e297`, `correction_required`): su hallazgo ya
  está corregido en `e1304a49` (aprobado). No se pudo abandonar desde Pi: el host convierte el `input` JSON en objeto y la
  operación exige texto. Cerrarlo con la CLI `gentle-ai review abandon` y reportar el bug del host. Limpiar después el
  worktree `.scratch/review-b8c` y las vistas en `.git/gentle-ai/candidate-views/` cuya limpieza quedó diferida por timeout.
- 🔲 **Integración silenciosa**: sin `DRAFT_TEST_DATABASE_URL` los tests de integración hacen SKIP y la corrida dice `ok`;
  `cmd/migrate` y `localbootstrap` necesitan un `DATABASE_URL` con `CREATEDB`; `scripts/closure` falla con bash 3.2 de macOS;
  `archguard` marca `docker/minio/Dockerfile` (preexistente). Un test unitario de `cmd/api` falló una vez sin identificarse
  (no se reprodujo en 5 corridas).
- 🔲 **Ramas ya mergeadas para borrar** (decisión del usuario): `feat/psychometric-tests-backend`,
  `feat/psychometric-competency-clarity-backend` y las del frontend.

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

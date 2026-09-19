# Modelo de Datos — Proyecto 04: Plataforma Pública de Vacantes

Base de datos: **PostgreSQL 16** local. `future/non-MVP`: RDS Multi-AZ vía RDS Proxy (fase AWS).
Este documento consolida todas las decisiones de modelado y el DDL de las 9 tablas entregadas (8 de entidad + el catálogo de referencia `industries`).

Arquitectura de referencia: ver memoria `architecture/proyecto-04-vacantes-aws` y diagrama Excalidraw (https://app.excalidraw.com/s/9kHweo4tLb6/6VfQhv4lo5D) — `future/non-MVP`.

---

## 1. Decisiones transversales

### 1.1 Primary keys: UUID v7 generado en Go

- **Decisión**: todas las tablas usan `UUID` como PK, generado con UUID v7 en la capa de aplicación (librería `google/uuid`).
- **Por qué no `BIGSERIAL`**: la plataforma es pública; IDs secuenciales son enumerables (un scraper puede recorrer `/jobs/1`, `/jobs/2`... y deducir volumen de negocio).
- **Por qué no UUID v4**: es aleatorio puro y fragmenta el índice B-tree (inserts en posiciones aleatorias del índice).
- **Por qué v7**: no enumerable Y ordenado por tiempo, así que los índices se mantienen sanos.
- **Por qué en Go y no en la DB**: encaja con arquitectura hexagonal — el dominio crea la entidad completa con su ID sin depender de un round-trip a la base.
- **Excepción — tablas de catálogo/referencia**: `industries` usa una PK `TEXT` (slug estable, ej. `'technology'`) en vez de UUID. Razón: es un vocabulario controlado, chico y estable; el slug hace los FKs legibles (`companies.industry_id = 'technology'`) y se mantiene idéntico entre entornos (local/staging/prod), evitando sincronizar UUIDs aleatorios. La regla UUID v7 aplica a tablas de **entidad**, no de catálogo.

### 1.2 Estrategia de borrado diferenciada por tabla

No hay una política global; cada tabla usa la estrategia que corresponde a lo que guarda:

| Tabla | Estrategia | Razón |
|---|---|---|
| `companies`, `users`, `jobs` | Soft delete (`deleted_at`) | Histórico de negocio, posibilidad de reactivación, integridad de FKs |
| `applications` | Anonimización (`anonymized_at`) | PII de candidatos: la LFPDPPP (derechos ARCO, Cancelación) exige borrado real. Hoy solo existe la columna `anonymized_at`; el ciclo completo (borrado de PII y del CV en S3) es `future/non-MVP` |
| `audit_events` | Nunca se borra | Append-only; es evidencia de auditoría |
| `industries` | Desactivación (`active`) | Catálogo de referencia: no se borra, se marca `active = false`; las empresas que ya lo referencian siguen apuntando a una fila válida |

**Consecuencia del soft delete**: los `UNIQUE` se implementan como índices únicos **parciales** (`WHERE deleted_at IS NULL`) para que una fila borrada no bloquee el re-registro (mismo RFC, mismo email).

### 1.3 Estados y roles: `TEXT` + `CHECK` constraint

- **Decisión**: valores cerrados (status, role, seniority, etc.) se modelan como `TEXT` con `CHECK` constraint. No se usan ENUM nativos de Postgres ni lookup tables.
- **Por qué no ENUM nativo**: agregar un valor es fácil, pero renombrar o borrar uno es una migración dolorosa (crear tipo nuevo, migrar columna, dropear el viejo).
- **Por qué no lookup tables**: se justifican cuando el negocio administra los valores en runtime. Aquí los estados son parte de la lógica de dominio (cambian con deploy de código, disparan eventos).
- **Patrón**: Go define el vocabulario (constantes tipadas), Postgres lo hace cumplir (CHECK). Cambiar valores = migración trivial de drop/add constraint.
- **Excepción `audit_events.event_type`**: no lleva CHECK — se agregan tipos de evento constantemente y no se quiere una migración por cada uno.
- **Excepción `companies.industry_id` (lookup table)**: la industria SÍ se modela como tabla de referencia (`industries`) con FK, no como CHECK. Cumple el criterio que esta misma sección define: es un catálogo **administrado en runtime** por el negocio (un admin agrega/desactiva industrias sin deploy) y requiere metadata (label i18n es/en, orden de despliegue). Validación en capas: el frontend ofrece las opciones (UX); en Go, el dominio solo rechaza un `industry_id` **vacío** **antes** de tocar la DB (validación pre-SQL), y la existencia **y** el `active = true` los hace cumplir el create gate SQL atómico de `CreateCompany` (CTE `active_industry` con `FOR UPDATE` en la **misma** sentencia). El **FK** `industry_id → industries(id)` queda como **backstop** de **integridad** referencial, no como el gate de negocio.

### 1.4 Timestamps

- Siempre `TIMESTAMPTZ`, nunca `TIMESTAMP` (guarda el instante en UTC; evita bugs de zona horaria).
- Convención: `created_at` y `updated_at` en tablas mutables; `occurred_at` en eventos.

### 1.5 Identidad: Cognito + Postgres

- Cognito User Pool único con Groups (`candidates`, `recruiters`, `company_admins`) es source of truth de **identidad/auth** (password, MFA, tokens).
- Postgres es source of truth de **dominio**. El puente es `users.cognito_sub` (claim `sub` del JWT). Nunca usar email como puente: el email puede cambiar, el `sub` jamás.
- Los candidatos **sí tienen cuenta** — aplicar requiere siempre registro (decisión de producto: habilita "mis aplicaciones", estados, perfil reutilizable y CV guardado).

### 1.6 Identidad vs rol

- `users.user_type` (`candidate` | `recruiter`) es **identidad**: qué clase de persona es en la plataforma. No cambia.
- `company_members.role` (`owner` | `recruiter`) es **rol**: qué puede hacer dentro de su empresa. Puede cambiar (transferencia de ownership) sin mutar la identidad.
- "Owner" NO es un `user_type`: el owner es un reclutador con más permisos, y el dato viviría duplicado/contradictorio.

### 1.7 Modelo usuario↔empresa: una empresa por usuario (Modelo A)

- Decisión de arquitectura: un user pertenece a UNA empresa.
- Se implementa con tabla de relación `company_members` + `UNIQUE (user_id)`: cumple la regla de hoy y deja la migración a multi-empresa como un simple drop del constraint.
- Invariante "solo users `recruiter` tienen fila en `company_members`" se valida en la capa de dominio Go (sin triggers).

### 1.8 Búsqueda: estructurado vs full-text

Regla: **lo que se filtra, se estructura; lo que se lee, va a full-text.**

- Filtros exactos (seniority, work_mode, ciudad, años de experiencia, skills) → columnas estructuradas con índices B-tree/GIN.
- Texto libre ("Golang, Next.js, AWS", "Full Stack developer") → `tsvector` generado (`GENERATED ALWAYS ... STORED`) con índice GIN, config `'spanish'`, pesos `setweight` (título A > resumen/descripción B).
- Tanto `jobs` como `candidate_profiles` tienen `search_vector`. Hoy está entregada la búsqueda de vacantes (candidatos buscan vacantes); la búsqueda de candidatos por reclutadores es `future/non-MVP`.

### 1.9 Campos del PRD de candidato

Basado en `docs/Estructura de Formulario de Candidato - Sistema de Reclutamiento.md`:

- Se incluyen todos los campos del PRD. `birth_date` y salario actual (bruto/neto) se mantienen **por decisión de producto**, con dos condiciones: son opcionales (nullable) y el aviso de privacidad debe declararlos con finalidad explícita. (Riesgo identificado: minimización de datos LFPDPPP y discriminación por edad — decisión consciente del equipo.)
- "¿Cómo se enteró de la vacante?" se movió a `applications.source`: es un dato de la aplicación, no del perfil (el mismo candidato llega a distintas vacantes por distintas fuentes).
- Listas se modelan según su forma: idiomas con nivel → tabla hija `candidate_languages`; skills → `TEXT[]` con GIN (normalizar a lowercase en la capa Go).

---

## 2. Diagrama de relaciones

```
industries ──< companies ──< company_members >── users ──1:1── candidate_profiles
companies ──< jobs ──< applications >── users (candidate)   users ──< candidate_languages
audit_events (sin FKs — append-only, sobrevive a sus actores)
```

---

## 3. DDL

### 3.1 `companies`

```sql
CREATE TABLE companies (
    id                 UUID PRIMARY KEY,
    name               TEXT NOT NULL,
    rfc                TEXT NOT NULL,
    industry_id        TEXT NOT NULL REFERENCES industries (id),
    website            TEXT,
    logo_url           TEXT,
    status             TEXT NOT NULL DEFAULT 'active'
        CONSTRAINT companies_status_check
        CHECK (status IN ('pending_verification', 'active', 'suspended')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ,
    description        TEXT,
    size               TEXT
        CONSTRAINT companies_size_check
        CHECK (size IS NULL OR size IN ('startup', 'small', 'medium', 'large', 'enterprise')),
    founded_year       SMALLINT
        CONSTRAINT companies_founded_year_check
        CHECK (founded_year IS NULL OR (founded_year >= 1800 AND founded_year <= 2200)),
    city               TEXT,
    country            TEXT,
    linkedin_url       TEXT,
    instagram_url      TEXT,
    facebook_url       TEXT,
    twitter_url        TEXT,
    cover_image_url    TEXT
);

CREATE INDEX companies_industry_id_idx ON companies (industry_id);

CREATE UNIQUE INDEX companies_rfc_unique
    ON companies (rfc) WHERE deleted_at IS NULL;
```

Notas:
- **Esquema consolidado de `00002` + `00003` + `00004`**: `00002` crea la tabla base, `00003` agrega las columnas de perfil al final (por eso van después de `deleted_at`), y `00004` cambia el DEFAULT de `status` a `'active'`.
- `status` nace en `active` (decisión MVP): no hay pipeline de verificación en el primer funcional. La validación básica (name/rfc/industry) es el único gate. `suspended` es el takedown manual. `pending_verification` queda reservada para el flujo avanzado diferido — ver `docs/flujo-verificacion-empresas.md`.
- **Perfil rico**: `size` con CHECK (`startup`/`small`/`medium`/`large`/`enterprise`, `NULL` permitido) y `founded_year` con CHECK estático `1800..2200` (`NULL` permitido). El rango estricto con cota móvil (`currentYear + 1`) es regla del VO `FoundedYear`, que corre antes de la DB; el CHECK de la DB es defense-in-depth y ambos deben moverse juntos.
- Índice único parcial en `rfc`: la unicidad aplica solo entre empresas vivas.
- `industry_id` es FK obligatoria a `industries` (catálogo, ver §3.1.1). `ON DELETE` por default (RESTRICT): no se puede borrar una industria en uso. El índice `companies_industry_id_idx` es manual porque Postgres **no** indexa automáticamente la columna que origina un FK (solo la PK referenciada).

### 3.1.1 `industries` (catálogo de referencia)

Tabla de catálogo administrada en runtime. **Se crea primero** (migración `00001`) por ser destino del FK de `companies`. PK `TEXT` (slug) — ver excepción en §1.1.

```sql
CREATE TABLE industries (
    id          TEXT PRIMARY KEY,
    label_es    TEXT NOT NULL,
    label_en    TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notas:
- **i18n**: `label_es` / `label_en` cubren es/en. Si se suman más idiomas, migrar a tabla `industry_translations`.
- **Sin soft delete**: una industria no se borra, se marca `active = false` (ver §1.2). Desaparece del frontend pero las empresas que la referencian siguen válidas.
- **Datos semilla** en la migración (9 industrias base: technology, retail, manufacturing, finance, healthcare, education, construction, hospitality, other). Son datos de catálogo que la app requiere; los admins agregan más en runtime.

### 3.2 `users`

```sql
CREATE TABLE users (
    id           UUID PRIMARY KEY,
    cognito_sub  TEXT NOT NULL,
    email        TEXT NOT NULL,
    full_name    TEXT NOT NULL,
    user_type    TEXT NOT NULL
        CONSTRAINT users_user_type_check
        CHECK (user_type IN ('candidate', 'recruiter')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX users_cognito_sub_unique
    ON users (cognito_sub) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_email_unique
    ON users (email) WHERE deleted_at IS NULL;
```

Notas:
- Sin `password` (vive en Cognito), sin `role`/`company_id` (viven en `company_members`).
- Fila creada por el backend cuando Cognito dispara el trigger PostConfirmation (ejecutable `cmd/postconfirmation`).

### 3.3 `candidate_profiles`

```sql
CREATE TABLE candidate_profiles (
    user_id                 UUID PRIMARY KEY REFERENCES users (id),
    phone                   TEXT,
    linkedin_url            TEXT,
    portfolio_url           TEXT,
    professional_title      TEXT,
    current_company         TEXT,
    years_of_experience     SMALLINT,
    profile_summary         TEXT,
    birth_date              DATE,
    city                    TEXT,
    country                 TEXT,
    education_level         TEXT
        CONSTRAINT candidate_profiles_education_check
        CHECK (education_level IN ('high_school', 'bachelor', 'master', 'phd')),
    field_of_study          TEXT,
    skills                  TEXT[] NOT NULL DEFAULT '{}',
    current_salary_gross    INTEGER,
    current_salary_net      INTEGER,
    expected_salary         INTEGER,
    salary_currency         TEXT NOT NULL DEFAULT 'MXN',
    expected_salary_period  TEXT
        CONSTRAINT candidate_profiles_salary_period_check
        CHECK (expected_salary_period IN ('monthly', 'annual')),
    cv_s3_key               TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    search_vector           tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', coalesce(professional_title, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(profile_summary, '')), 'B')
    ) STORED
);

CREATE INDEX candidate_profiles_skills_idx
    ON candidate_profiles USING GIN (skills);
CREATE INDEX candidate_profiles_search_idx
    ON candidate_profiles USING GIN (search_vector);
CREATE INDEX candidate_profiles_city_idx
    ON candidate_profiles (city);
```

Notas:
- PK = `user_id` (relación 1:1 con `users`; estructura garantiza un solo perfil por user, JOIN gratis).
- `skills`: normalizar a lowercase en Go antes de guardar ("Go" ≠ "go" para el índice).
- `search_vector` habilita búsquedas tipo "Full Stack developer"; la búsqueda de candidatos por reclutadores es `future/non-MVP` (sin endpoint entregado).

### 3.4 `candidate_languages`

```sql
CREATE TABLE candidate_languages (
    user_id     UUID NOT NULL REFERENCES users (id),
    language    TEXT NOT NULL,
    level       TEXT NOT NULL
        CONSTRAINT candidate_languages_level_check
        CHECK (level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),

    PRIMARY KEY (user_id, language)
);
```

Notas:
- PK compuesta impide declarar dos niveles para el mismo idioma.
- Niveles CEFR según el PRD.

### 3.5 `company_members`

```sql
CREATE TABLE company_members (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users (id),
    company_id  UUID NOT NULL REFERENCES companies (id),
    role        TEXT NOT NULL
        CONSTRAINT company_members_role_check
        CHECK (role IN ('owner', 'recruiter')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX company_members_user_id_unique
    ON company_members (user_id);

CREATE INDEX company_members_company_id_idx
    ON company_members (company_id);
```

Notas (alineadas con la migración `00009`):
- `company_members_user_id_unique` implementa el Modelo A (una empresa por usuario). Es un índice UNIQUE **no parcial** porque el borrado de membresía es hard delete: reinsertar el mismo `user_id` después de un remove es intencional. Migrar a multi-empresa = dropear ese índice.
- `company_members_company_id_idx` sirve los joins por FK y la query `ListByCompanyID` (`WHERE company_id = $1`); Postgres no indexa automáticamente la columna que origina un FK.
- `role` queda acotado por el CHECK nombrado `company_members_role_check` (`owner`/`recruiter`): el VO `MemberRole` valida en la aplicación y el CHECK es la última línea de defensa en la DB.
- `created_at` y `updated_at` son `NOT NULL DEFAULT now()`; `updated_at` lo actualiza el cambio de rol.

### 3.6 `jobs`

```sql
CREATE TABLE jobs (
    id               UUID PRIMARY KEY,
    company_id       UUID NOT NULL REFERENCES companies (id),
    title            TEXT NOT NULL,
    description      TEXT NOT NULL,
    work_mode        TEXT NOT NULL
        CONSTRAINT jobs_work_mode_check
        CHECK (work_mode IN ('onsite', 'remote', 'hybrid')),
    employment_type  TEXT NOT NULL
        CONSTRAINT jobs_employment_type_check
        CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship')),
    seniority        TEXT NOT NULL
        CONSTRAINT jobs_seniority_check
        CHECK (seniority IN ('intern', 'junior', 'mid', 'senior', 'lead')),
    status           TEXT NOT NULL DEFAULT 'draft'
        CONSTRAINT jobs_status_check
        CHECK (status IN ('draft', 'published', 'closed')),
    location         TEXT,
    salary_min       INTEGER,
    salary_max       INTEGER,
    salary_currency  TEXT NOT NULL DEFAULT 'MXN'
        CONSTRAINT jobs_salary_currency_check
        CHECK (salary_currency IN ('USD', 'MXN')),
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    CONSTRAINT jobs_published_integrity_check
        CHECK (status <> 'published' OR published_at IS NOT NULL),

    search_vector    tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(description, '')), 'B')
    ) STORED
);

CREATE INDEX jobs_search_idx ON jobs USING GIN (search_vector);
CREATE INDEX jobs_company_id_idx ON jobs (company_id);
CREATE INDEX jobs_public_listing_idx
    ON jobs (published_at DESC)
    WHERE status = 'published' AND deleted_at IS NULL;
```

Notas (alineadas con la migración `00007`):
- La propiedad se deriva de la empresa vía `company_members`: la tabla no guarda un autor por fila, y `seniority` no tiene índice dedicado (se filtra sobre columnas estructuradas).
- `salary_currency` es `NOT NULL DEFAULT 'MXN'` con CHECK (`USD`/`MXN`).
- `jobs_published_integrity_check`: una vacante `published` siempre tiene `published_at`.
- `jobs_company_id_idx`: B-tree para el join por FK y las queries por empresa.
- `search_vector` mantenido por Postgres (`GENERATED ... STORED`): sin triggers, imposible desincronizar.
- `jobs_public_listing_idx` (parcial): sirve la query más caliente — listado público de vacantes publicadas, recientes primero.

### 3.7 `applications`

```sql
CREATE TABLE applications (
    id            UUID PRIMARY KEY,
    job_id        UUID NOT NULL REFERENCES jobs (id),
    candidate_id  UUID NOT NULL REFERENCES users (id),
    status        TEXT NOT NULL DEFAULT 'submitted'
        CONSTRAINT applications_status_check
        CHECK (status IN ('submitted', 'in_review', 'rejected', 'hired')),
    source        TEXT
        CONSTRAINT applications_source_check
        CHECK (source IN ('referral', 'linkedin', 'job_board', 'direct', 'other')),
    cover_letter  TEXT,
    cv_s3_key     TEXT,
    anonymized_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT applications_job_candidate_unique UNIQUE (job_id, candidate_id)
);

CREATE INDEX applications_by_job_idx
    ON applications (job_id, status, created_at DESC);
CREATE INDEX applications_by_candidate_idx
    ON applications (candidate_id, created_at DESC);
```

Notas:
- `UNIQUE (job_id, candidate_id)`: nadie aplica dos veces a la misma vacante (regla de negocio como estructura).
- `cv_s3_key` propio = **snapshot** del CV al momento de aplicar. La columna está entregada y es nullable; `future/non-MVP`: el ciclo de vida del CV en S3 (almacenamiento y borrado real).
- `anonymized_at` es la columna de cancelación LFPDPPP: `future/non-MVP`, el flujo efectivo (PII fuera, CV borrado de S3, fila conservada para métricas) todavía no está implementado.
- `source`: campo movido desde el PRD de candidato — es dato de la aplicación, no del perfil.

### 3.8 `audit_events`

```sql
CREATE TABLE audit_events (
    id           UUID PRIMARY KEY,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id     UUID,
    actor_type   TEXT NOT NULL
        CONSTRAINT audit_events_actor_type_check
        CHECK (actor_type IN ('user', 'system')),
    event_type   TEXT NOT NULL,
    entity_type  TEXT NOT NULL,
    entity_id    UUID NOT NULL,
    metadata     JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_events_entity_idx
    ON audit_events (entity_type, entity_id, occurred_at DESC);
```

Notas:
- `actor_id` **sin FK, a propósito**: el audit log debe sobrevivir a sus actores. Es evidencia.
- Append-only: sin `updated_at`, sin `deleted_at`, sin UPDATE/DELETE jamás.
- `event_type` sin CHECK (excepción a la regla 1.3): los tipos de evento crecen constantemente.
- Alternativa futura evaluada en arquitectura: mover a DynamoDB con TTL si el volumen lo justifica.

---

## 4. Sample queries de validación

Las queries calientes del producto, para validar que el modelo las sirve naturalmente.

### 4.1 Candidato busca vacantes por texto ("Golang, Next.js, AWS")

```sql
SELECT j.id, j.title, j.location, j.work_mode, j.seniority, j.salary_min, j.salary_max,
       ts_rank(j.search_vector, websearch_to_tsquery('spanish', 'golang next.js aws')) AS rank
FROM jobs j
JOIN companies c ON c.id = j.company_id
WHERE j.status = 'published'
  AND j.deleted_at IS NULL
  AND c.status = 'active'
  AND c.deleted_at IS NULL
  AND j.search_vector @@ websearch_to_tsquery('spanish', 'golang next.js aws')
ORDER BY rank DESC, j.published_at DESC
LIMIT 20;
```

- `websearch_to_tsquery` parsea texto libre del usuario de forma segura (no lanza error de sintaxis con input raro).
- El ranking pesa título (A) sobre descripción (B).
- La visibilidad es la canónica de `jobs.sql`: la vacante `published` y viva, **y** la empresa dueña `active` y no tombstoned (`c.status = 'active'` + `c.deleted_at IS NULL`).

### 4.2 Candidato busca con filtros estructurados + texto ("Senior python developer")

```sql
SELECT j.id, j.title, j.location, j.work_mode, j.salary_min, j.salary_max
FROM jobs j
JOIN companies c ON c.id = j.company_id
WHERE j.status = 'published'
  AND j.deleted_at IS NULL
  AND c.status = 'active'
  AND c.deleted_at IS NULL
  AND j.seniority = 'senior'
  AND j.work_mode IN ('remote', 'hybrid')
  AND j.search_vector @@ websearch_to_tsquery('spanish', 'python developer')
ORDER BY ts_rank(j.search_vector, websearch_to_tsquery('spanish', 'python developer')) DESC
LIMIT 20;
```

- El seniority va por filtro exacto, el resto por FTS, siempre sobre vacantes visibles (misma dupla `c.status = 'active'` + `c.deleted_at IS NULL`). UI recomendada: facetas (seniority, modalidad, ubicación) + caja de texto.

### 4.3 `future/non-MVP` — Reclutador busca candidatos (skills + localidad + experiencia)

Ilustrativa, no entregada: el endpoint de búsqueda de candidatos por reclutadores es `future/non-MVP`.

```sql
SELECT u.id, u.full_name, cp.professional_title, cp.city,
       cp.years_of_experience, cp.expected_salary, cp.skills
FROM candidate_profiles cp
JOIN users u ON u.id = cp.user_id AND u.deleted_at IS NULL
WHERE cp.skills @> ARRAY['golang', 'aws']        -- tiene TODAS estas skills (GIN)
  AND cp.city = 'Guadalajara'
  AND cp.years_of_experience >= 5
ORDER BY cp.years_of_experience DESC
LIMIT 20;
```

### 4.4 `future/non-MVP` — Reclutador busca candidatos por texto ("Full Stack developer")

```sql
SELECT u.id, u.full_name, cp.professional_title, cp.city,
       ts_rank(cp.search_vector, query) AS rank
FROM candidate_profiles cp
JOIN users u ON u.id = cp.user_id AND u.deleted_at IS NULL,
     websearch_to_tsquery('spanish', 'full stack developer') AS query
WHERE cp.search_vector @@ query
ORDER BY rank DESC
LIMIT 20;
```

### 4.5 Pipeline del reclutador (aplicaciones de una vacante)

```sql
SELECT a.id, a.status, a.source, a.created_at,
       u.full_name, cp.professional_title, cp.years_of_experience
FROM applications a
JOIN users u ON u.id = a.candidate_id
LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
WHERE a.job_id = $1
  AND a.status = 'in_review'
  AND a.anonymized_at IS NULL
ORDER BY a.created_at DESC;
```

- Usa `applications_by_job_idx` (job_id, status, created_at DESC) — index scan directo.

### 4.6 "Mis aplicaciones" del candidato

```sql
SELECT a.id, a.status, a.created_at,
       j.title AS job_title, j.seniority, c.name AS company_name
FROM applications a
JOIN jobs j ON j.id = a.job_id
JOIN companies c ON c.id = j.company_id
WHERE a.candidate_id = $1
ORDER BY a.created_at DESC;
```

- Usa `applications_by_candidate_idx`. No filtra `j.deleted_at`: el candidato debe ver su historial aunque la vacante ya no exista.

---

## 5. Pendientes / temas abiertos

- ✅ Herramienta de migraciones decidida: **goose**, ejecutada por el ejecutable `cmd/migrate` (binario autocontenido con migraciones embebidas). `future/non-MVP`: el despliegue como ECS task one-off antes de cada deploy.
- [ ] `future/non-MVP`: definir TTL de retención para `applications` no anonimizadas (política LFPDPPP).
- [ ] Aviso de privacidad: debe declarar explícitamente `birth_date` y salario actual con su finalidad.
- ✅ Vocabulario cerrado de `event_type` para `audit_events`: 4 eventos entregados (`ApplicationSubmitted`, `ApplicationTransitioned`, `CompanyUpdated`, `CompanyDeleted`). `future/non-MVP`: publicar eventos de integración hacia EventBridge/SQS en la fase AWS.
- [ ] Evaluar paginación keyset (cursor por `created_at`/`id`) en listados públicos cuando crezca el volumen.

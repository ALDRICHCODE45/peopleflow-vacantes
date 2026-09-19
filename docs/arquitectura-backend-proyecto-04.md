# Arquitectura del Backend — Proyecto 04: Plataforma Pública de Vacantes

Backend: **Go, monolito modular** (decisión de arquitectura: NO microservicios).
Este documento define la organización del código y las reglas que la mantienen sana.

Documentos relacionados:

- `docs/modelo-de-datos-proyecto-04.md` — modelo de datos Postgres: 9 tablas (8 de entidad + el catálogo `industries`)
- `docs/decision-frontend-hosting.md` — hosting del frontend Next.js (Amplify) y modelo de costo
- Memoria `architecture/proyecto-04-vacantes-aws` — arquitectura AWS completa; `future/non-MVP`.

---

## 1. Estilo arquitectónico: vertical slice + hexagonal + DDD pragmático

**Decisión**: organización _package-by-feature_ (screaming architecture) donde cada feature es un bounded context con su propia estructura hexagonal interna (domain / application / infrastructure).

**Explícitamente NO purista**: se toma de DDD lo que aporta (bounded contexts, value objects, eventos de dominio, ubiquitous language) sin ceremonia de libro. Se toma de hexagonal la regla de dependencias (ports & adapters) sin capas decorativas.

**Por qué este enfoque y no layered clásico** (domain/ application/ infrastructure/ como carpetas raíz):

- En layered, una feature vive regada en 4 carpetas; aquí el bounded context es **físico**: `features/jobs/` contiene TODO lo de jobs.
- La estructura de carpetas grita QUÉ HACE el sistema, no qué framework usa.
- Cada contexto tiene sus propios value objects, eventos de dominio y reglas — los patrones de diseño se aplican por contexto sin contaminar a los demás.
- Onboarding: un dev nuevo entiende el sistema leyendo `features/`.
- Si un día un contexto necesita extraerse a otro servicio, la costura ya existe.

## 2. Árbol del repositorio (monorepo)

```
/backend
  /cmd
    /api                      → composition root: cablea features, arranca HTTP
    /migrate                  → runner de migraciones autocontenido (goose embebido)
    /postconfirmation         → adaptador Lambda del trigger PostConfirmation
    /archguard                → guard de arquitectura (imports + reglas del repo)
  /internal
    /features
      /identity               → users, auth (JWKS producción / PEM local-test)
      /companies              → companies, company_members
      /candidates             → candidate_profiles, candidate_languages
      /jobs                   → jobs, publicación, búsqueda
      /applications           → applications, pipeline de reclutamiento
      /audit_events           → audit_events (append-only, co-write desde los write paths)
      /industries             → catálogo de referencia `industries`
        /domain               → entities, value objects, domain events, PORTS (interfaces)
        /application          → use cases (command/query handlers)
        /infrastructure       → ADAPTERS: postgres/ (repos), http/ (handlers de la feature)
    /shared                   → SOLO infraestructura transversal sin lógica de negocio:
                                db pool, config, middleware base, logger, httpjson
/frontend                     → Next.js (Amplify Hosting sigue `future/non-MVP`)
/workers                      → placeholder vacío (workers Go) — `future/non-MVP`
/infra                        → placeholder vacío (Terraform) — `future/non-MVP`
```

**Las features son bounded contexts, no tablas**: `companies` agrupa 2 tablas (`companies`, `company_members`) porque viven y mueren juntas. Las 7 features cubren las 9 tablas: `identity` (`users`), `companies` (`companies`, `company_members`), `candidates` (`candidate_profiles`, `candidate_languages`), `jobs` (`jobs`), `applications` (`applications`), `audit_events` (`audit_events`, feature propia append-only) e `industries` (catálogo de referencia).

## 3. Las tres reglas de oro (ley del repo)

Estas reglas son las que diferencian esta arquitectura de "carpetas bonitas". Se hacen cumplir por el guard de arquitectura **`archguard`** (`backend/internal/tools/archguard`, invocado por `cmd/archguard`), que es la fuente de verdad ejecutable; el code review lo acompaña, no lo reemplaza.

### Regla 1 — Comunicación entre features (solo excepciones documentadas)

Ninguna feature importa paquetes de otra feature: los imports cross-feature de `domain/`, `application/` e `infrastructure/` están prohibidos y fallan en el guard **`archguard`**.

El guard evalúa los imports de producción (`go list -json`, campo `Imports`), así que un `_test.go` puede armar fixtures cross-feature sin alterar este contrato.

Las **únicas** excepciones son las rutas exactas que el guard tiene documentadas — sin wildcards y sin excepciones implícitas — y son las que el código de producción realmente usa:

- Co-write de auditoría: `audit_events/domain/entities` y `audit_events/domain/repositories`.
- Puertos y entidades de dominio entre features: `identity/domain/entities`, `identity/domain/repositories`, `identity/domain/security`, `identity/domain/valueobjects`, y `companies/domain/entities`, `companies/domain/repositories`, `companies/domain/valueobjects`.

Todo lo demás se comunica por el composition root (`cmd/api` cablea las implementaciones concretas) o por el plumbing transversal de `shared/`. Sin esta regla, en 6 meses el resultado es un monolito espagueti con carpetas elegantes.

### Regla 2 — `shared/` minimalista

`shared/` es donde van a morir las arquitecturas. Regla: si tiene **lógica de negocio**, NO va en shared — va en la feature dueña, y las demás la consumen por su puerta de entrada (Regla 1). En shared solo vive plumbing: event bus, db pool, config, middleware, logging.

### Regla 3 — Dependencias hacia adentro

Dentro de cada feature: `domain` no importa NADA (ni infra, ni application, ni shared salvo tipos puros). `application` importa domain. `infrastructure` implementa los ports del domain. El cableado concreto ocurre únicamente en el composition root (`cmd/api`).

## 4. Eventos: dominio vs integración

Distinción que importa desde el día 1:

| Tipo                      | Alcance                                  | Transporte                                  | Ejemplo                                               |
| ------------------------- | ---------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| **Evento de dominio**     | In-process, dentro del monolito          | Auditoría co-escrita en la misma tx         | `ApplicationSubmitted` dispara regla en otro contexto |
| **Evento de integración** | `future/non-MVP`: sale hacia **workers** | `future/non-MVP`: **EventBridge** → **SQS** | `ApplicationSubmitted` → email-worker                 |

Hoy los eventos de dominio se materializan como **audit events** co-escritos atómicamente (`ApplicationSubmitted`, `ApplicationTransitioned`, `CompanyUpdated`, `CompanyDeleted`). El transporte de integración es `future/non-MVP`: **EventBridge** → **SQS**, los **workers** y el dispatcher/**outbox** todavía no existen — su diseño llega con la fase AWS.

## 5. Gotchas conocidos de Go con esta estructura

- `features/jobs/domain` y `features/companies/domain` son ambos `package domain` → en el composition root se aliasean imports (`jobsdomain "backend/internal/features/jobs/domain"`). Ruido manejable y asumido conscientemente (la variante idiomática Go pondría el dominio en la raíz del package de la feature, pero se prioriza la estructura explícita y enseñable).
- `internal/` garantiza que nada fuera de `/backend` pueda importar el código del backend.

## 6. Decisiones de librerías

| Decisión             | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router HTTP          | **DECIDIDO: chi** (`go-chi/chi`). Capa fina sobre `net/http`: handlers stdlib puros (`http.HandlerFunc`), `context.Context` real fluyendo, middlewares incluidos en `chi/middleware` (Logger, Recoverer, RequestID, Timeout). Helpers JSON propios (~20 líneas en shared). Se descartó gin: `gin.Context` envuelve el stdlib y se infiltra en las firmas de los handlers — contrario al objetivo de ganar soltura con Go y a los adapters framework-free de la arquitectura                                                                                             |
| Acceso a datos       | **DECIDIDO: sqlc + pgx/v5** debajo. Las queries se escriben a mano en archivos `.sql` (el SQL del modelo — tsvector, GIN, arrays — bajo control total); sqlc genera el código Go tipado (structs, params, escaneo) y valida el SQL contra el schema en tiempo de generación. SQL + generado viven en `infrastructure/postgres/` de cada feature; el repo-adapter convierte structs sqlc ↔ entidades de dominio (el dominio jamás ve sqlc). GORM descartado: esconde el SQL y maneja mal tsvector/GIN/arrays. Nota: Aldrich nunca usó sqlc — onboarding guiado pendiente |
| Dependency injection | **DECIDIDO: DI manual** en el composition root (`cmd/api/main.go`): cada feature construye repos → use cases → handlers a mano. El grafo de dependencias queda legible en una página (material de onboarding). wire descartado: codegen y errores crípticos a cambio de ahorrar constructores — complejidad sin retorno en un monolito de 7 features. Si el grafo algún día duele, migrar a wire es mecánico                                                                                                                                                            |
| Migraciones          | **DECIDIDO: goose**. SQL plano con anotaciones `-- +goose Up/Down` (un archivo por migración, imposible commitear up sin down), `embed.FS` de primera clase → `cmd/migrate` autocontenido **entregado** (`up`/`down`/`status`), y soporte de migraciones en Go para data migrations futuras. `future/non-MVP`: el despliegue del binario como one-off ECS task pre-deploy llega con la fase AWS. Cambiar a golang-migrate después sería solo renombrar archivos (SQL plano en ambas)                                                                                    |
| UUID v7              | `github.com/google/uuid` (decidido en modelo de datos)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Validación JWT       | **ENTREGADO**: `lestrrat-go/jwx` con **JWKS** de Cognito en producción (selección por `kid`, cache acotado, rotación) + modo PEM estático explícito solo local/test; fail-closed en startup y runtime                                                                                                                                                                                                                                                                                                                                                                   |

## 7. Pendientes

- ✅ Resuelto: `audit_events` vive como feature propia en `features/audit_events` (append-only; co-write atómico desde los write paths de `applications` y `companies`).
- [ ] `future/non-MVP`: diseñar el dispatcher de eventos de integración y el patrón outbox (o publish-after-commit) para la fase AWS.
- ✅ Entregado: el guard **`archguard`** hace cumplir las reglas de imports cross-feature y las reglas del repo.

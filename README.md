# PeopleFlow — Plataforma Pública de Vacantes (Proyecto 04)

Monorepo del producto. Plataforma pública de vacantes self-service.

## Estructura

```
/backend    → API Go (monolito modular: vertical slice + hexagonal + DDD pragmático)
/frontend   → Next.js (App Router, SSR/RSC)
/docs       → diseño técnico (arquitectura, modelo de datos, decisiones)
/infra      → placeholder vacío (Terraform) — future/non-MVP
/workers    → placeholder vacío (workers Go) — future/non-MVP
```

`/infra` y `/workers` existen hoy como directorios locales vacíos: pertenecen a la fase AWS, todavía `future/non-MVP`.

## Documentación de diseño

- `docs/arquitectura-backend-proyecto-04.md` — organización del backend Go
- `docs/modelo-de-datos-proyecto-04.md` — modelo de datos Postgres: 9 tablas (8 de entidad + el catálogo `industries`)
- `docs/decision-frontend-hosting.md` — hosting frontend (Amplify) + modelo de costo

## Contexto estratégico / comercial / legal

Vive en el repo aparte `PeopleflowStrategy` (análisis de comercialización, legal LFPDPPP,
roadmap integrado). Este repo es solo el código del producto.

## Stack entregado

- **Backend**: Go, chi (router), sqlc + pgx/v5 (datos), DI manual, goose (migraciones)
- **DB**: PostgreSQL 16 local
- **Auth**: Cognito (JWKS en producción; PEM estático solo local/test)

## Fase AWS — `future/non-MVP` (no implementada)

Nada de esta sección está implementado (`future/non-MVP`): hosting en AWS Amplify, RDS Multi-AZ vía RDS Proxy, ECS/Fargate (backend + workers), Terraform, EventBridge + SQS (eventos) y los workers Go.

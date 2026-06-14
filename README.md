# PeopleFlow — Plataforma Pública de Vacantes (Proyecto 04)

Monorepo del producto. Plataforma pública de vacantes self-service.

## Estructura

```
/backend    → API Go (monolito modular: vertical slice + hexagonal + DDD pragmático)
/frontend   → Next.js (App Router, SSR/RSC) — deploy en AWS Amplify Hosting
/infra      → Terraform (infraestructura AWS)
/workers    → Workers Go (email, notification, cv-processor)
/docs       → diseño técnico (arquitectura, modelo de datos, decisiones)
```

## Documentación de diseño

- `docs/arquitectura-backend-proyecto-04.md` — organización del backend Go
- `docs/modelo-de-datos-proyecto-04.md` — modelo de datos Postgres (9 tablas)
- `docs/decision-frontend-hosting.md` — hosting frontend (Amplify) + modelo de costo

## Contexto estratégico / comercial / legal

Vive en el repo aparte `PeopleflowStrategy` (análisis de comercialización, legal LFPDPPP,
roadmap integrado). Este repo es solo el código del producto.

## Stack

- **Backend**: Go, chi (router), sqlc + pgx/v5 (datos), DI manual, goose (migraciones)
- **Frontend**: Next.js + AWS Amplify Hosting
- **DB**: PostgreSQL 16 (RDS Multi-AZ vía RDS Proxy)
- **Infra**: ECS/Fargate (backend + workers), Cognito (auth), EventBridge + SQS (eventos)

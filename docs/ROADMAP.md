# ROADMAP — Estado y próximos pasos

> Archivo de continuidad. Si retomás el proyecto (esta u otra sesión/máquina), empezá leyendo esto.

## Dónde estamos

Fase de **diseño cerrada**. Arrancando **implementación del backend**.

- ✅ Arquitectura backend definida (`docs/arquitectura-backend-proyecto-04.md`)
- ✅ Modelo de datos: 9 tablas con DDL (`docs/modelo-de-datos-proyecto-04.md`)
- ✅ Hosting frontend: AWS Amplify (`docs/decision-frontend-hosting.md`)
- ✅ Repo de código separado del repo de estrategia (`PeopleflowStrategy`)
- ✅ Estructura monorepo creada: `backend/ frontend/ infra/ workers/ docs/`

## QUÉ SIGUE (próximo paso inmediato)

**Walking skeleton del backend, empezando por la capa de datos con sqlc + goose, usando la tabla `companies` como primera tabla para aprender el flujo.**

Aldrich es nuevo en sqlc → enseñar paso a paso el ciclo:
`escribir SQL a mano → sqlc generate → código Go tipado`.

Secuencia acordada para el backend:

1. `go mod init github.com/aldrichcode45/peopleflow-vacantes` (module path en MINÚSCULAS).
   - Decisión pendiente al scaffoldear: un solo módulo en la raíz vs módulo por deployable
     (backend/workers). Afecta si workers puede importar `internal/` del backend.
2. Setup **goose**: primera migración = schema de `companies` (ver DDL en modelo-de-datos §3.1).
3. Setup **sqlc** (`sqlc.yaml`): schema desde las migraciones, queries en `.sql`.
4. Escribir primeras queries de `companies` (CreateCompany, GetCompanyByID) → `sqlc generate`.
5. Revisar juntos el código tipado generado (entender qué hace sqlc por nosotros).
6. **docker-compose** con Postgres 16 local + correr goose para aplicar la migración end-to-end.
7. `main.go` composition root mínimo + servidor chi con `/healthz`.

Después: montar la primera feature completa (`identity` o `companies`) sobre el esqueleto.

## Stack decidido (no re-discutir)

- Router: **chi** | Datos: **sqlc + pgx/v5** | DI: **manual** | Migraciones: **goose**
- DB: PostgreSQL 16 | PK: UUID v7 generado en Go (`google/uuid`)

## Herramientas a instalar en máquina nueva

- Go (ya 1.26.1 en la máquina actual), Docker
- `go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest`
- `go install github.com/pressly/goose/v3/cmd/goose@latest`

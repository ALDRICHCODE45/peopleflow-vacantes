# Flujo de verificación de empresas

> Decisión de dominio. Este documento separa lo que el MVP SÍ hace de lo que quedó DIFERIDO para después, para no perder el diseño del flujo avanzado.

## Decisión MVP (agosto 2026)

Para el primer MVP funcional **NO hay flujo de verificación**. Las empresas nacen `active` y listo.

- **Nace `active`** — `NewCompany` arranca con `status = active`. La migración `00004` cambia el `DEFAULT` de la columna a `'active'` y hace backfill de las filas existentes que estaban en `pending_verification`.
- **"Verificación" = validación básica de campos** — lo que ya existe y alcanza para arrancar:
  - `name` obligatorio (VO `CompanyName`).
  - `rfc` obligatorio + **único** entre empresas vivas (índice único parcial `companies_rfc_unique`).
  - `industry_id` obligatorio + existente en el catálogo (FK + `ErrIndustryNotFound` → 400).
- **`suspended` es la ÚNICA palanca anti-fraude del MVP** — un admin suspende manualmente una empresa reportada. Estrategia **reactiva**, no proactiva.
- **`pending_verification` queda reservada** como vocabulario (no se usa en el MVP). Se mantiene en el `CHECK` y en `ParseCompanyStatus` para que el flujo avanzado no requiera migración de schema cuando llegue.

### Por qué no hay flujo proactivo en el MVP

- El tráfico esperado es ~nulo; el takedown manual alcanza.
- Un pipeline (subida de documentos, cola de aprobación de un admin, lookup de RFC contra el SAT) es overkill para el primer funcional y distrae del core (vacantes + postulaciones).

## Regla que lo hereda

- `jobs`: **"solo empresa `active` publica"** — sigue siendo la regla. En el MVP se cumple trivialmente porque todo nace `active`.

## Flujo avanzado (DIFERIDO — post-MVP)

Diseño a definir cuando la bolsa agarre tráfico real. Guía para no empezar de cero:

1. **Alta**: la empresa nace `pending_verification` (revertir factory + `DEFAULT` a `pending_verification`).
2. **Evidencia**: la empresa sube documentación (constancia de situación fiscal del SAT en PDF, RFC, opcional comprobante de dominio del `website`).
3. **Cola de revisión**: un rol de staff/admin revisa y aprueba (`pending_verification` → `active`) o rechaza con motivos (la empresa reenvía).
4. **Verificación automática (opcional)**: lookup del RFC contra el SAT para validar razón social/estatus fiscal antes de la revisión humana.
5. **`suspended` sigue siendo takedown manual** (denuncias de candidatos, reincidencia).

### Consideraciones a resolver cuando se diseñe

- ¿Quién revisa? (rol nuevo tipo `staff` vs un `company_admin` de otra empresa — NO).
- ¿Tiempo límite de la cola? (una empresa que queda años en `pending_verification` ensucia métricas).
- ¿Re-verificación? (cambios de razón social / RFC).
- Integración con `audit_events`: `CompanyVerified`, `CompanySuspended`, etc. (ver modelo de datos §5, catálogo inicial de `event_type`).

## Referencias

- Campo y `CHECK` en `backend/db/migrations/00002_create_companies.sql` (schema) y `00004_companies_active_default.sql` (default MVP).
- Estado en dominio: `internal/features/companies/domain/valueobjects/companyStatus.go`.
- Factory: `internal/features/companies/domain/entities/company.go`.
- Modelo de datos: `docs/modelo-de-datos-proyecto-04.md` §3.1.

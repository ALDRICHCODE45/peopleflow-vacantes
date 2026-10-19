# Candidate profile and company structured locations (G3) — frontend

Frontend of backend G3 (`backend/docs/geo-profiles.md`, `candidate-profile.md`, `company-profile.md` on
`feat/geo-profiles` in `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes`; design §20.5).
Branch `feat/geo-profiles-ui`, stacked on `feat/geo-vacancy-ui` (shared LocationField + geo contracts in
`frontend/src/features/geo/`).

## Specs

- S1. User answers (verbatim): depth «candidato: estoy de acuerdo» (up to municipality, no postal code), «empresa: estoy de acuerdo» (up to municipality + postal code); «Solo cuando hace falta (Recomendado)» — candidate location optional (country required only to apply to a country-restricted vacancy, G4); company optional, as today.
- S2. Contract: candidate GET/PUT `/me/profile`: `city`/`country` replaced by `location` (read five-key object | null; write `{country,state?,municipality?}` | null; PUT omitted/null clears; any postal key → 422 not_allowed). Company POST `/companies` optional `location` (write with postal); read shapes on GET `/me/company` membership company, GET `/companies/{id}`. 422 `invalid_location` details `{field:"location.<level>", reason}` (note: no `fields.` prefix here).
- S3. Current frontend: company has NO location UI (create form: name, RFC, industry; read-only details; no edit screen). Scope: optional LocationField in the create form + location label in the details view. Editing: user chose «Sí, editar ubicación (Recomendado)» — «Botón «Editar ubicación» para el dueño en Configuración → Empresa; usa el PATCH que el backend ya tiene (sin cambios de backend).» → owner-only Dialog with LocationField (CP) → PATCH /me/company {location} with the existing CAS semantics.
- S4. UI rules: docs/frontend-ui-design-rules.md (all; «Ubicaciones», §16–§19).

## Tasks

- T1 [pending] S1-S4 | writer A | Candidate profile: replace city/country with LocationField (no CP), decoders, 422, application wizard/candidate card shows the label. | commit: -
- T2 [pending] S1-S4 | writer B | Company: optional LocationField (with CP) in the create form, decoders, 422, label in the details view, owner «Editar ubicación» dialog (PATCH). | commit: -
- T3 [pending] | parent | Full suite, guide step, queue paired with backend row 14. | commit: -

## Log

- L1. Backend G3: 9a3b9af (+ merge of the 00031 NUL fix d4a4477); migration 00032 drops free-text city/country (no backfill). Until G4 the §19 snapshot `city` is null for new applications.

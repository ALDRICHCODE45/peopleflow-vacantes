# Structured geography (geo location)

Backend side of catalog-based locations everywhere a location is asked, delivered cut by cut with the frontend agent.
Design: `docs/geo-location-design.md` (§20). Branch `feat/geo-location-design` from main ef75173. Same delivery rules as pipeline customization (S3 there).

## Specs

- **S1.** Feature (user, relayed by the frontend): structured geography catalogs everywhere a location is asked (better data, precise filters, analytics, SEO structured location), including lookup by postal code.
- **S2.** «vacante: estoy de acuerdo. empresa: estoy de acuerdo, candidato: estoy de acuerdo.» — to the recommendation: vacante hasta municipio + CP opcional; empresa hasta municipio + CP; candidato hasta municipio, sin colonia ni calle.
- **S3.** «Creo que la ubicacion puede ser opcional para vacantes remotas, pero evidentemente en ese caso se deberia de poner explicitamente que no importa desde que ubicacion aplique el candidato, o puedes elegir, solo se puede aplicar desde estos paises, me explico?» — P1 «Bloquea la postulación (Recomendado)»; P2 «Cualquier lugar o estos países (Recomendado)».
- **S4.** «Si, solo mexico por ahora, pero realmente si conviene dejar la puerta abierta para el detalle internacional.» — P4 «Lista mundial; detalle solo MX (Recomendado)».
- **S5.** P3 «Sí, como presencial (Recomendado)» — hybrid requires location like onsite.
- **S6.** P5 «Solo cuando hace falta (Recomendado)» — candidate country required only to apply to a country-restricted vacancy.
- **S7.** P6 «Estado, municipio, modalidad (Recomendado)» — public search filters.
- **S8.** «Por eso no te preocupes hermano, todos los datos que se ocupan ahora son datos de prueba, podriamos eliminar toda la base de datos y no importaria, no hay nada real que importe aqui. tu tranquilo.» — no legacy migration/backfill; free-text fields can be replaced.
- **S9.** Technical assumptions accepted by the user: codes stored, `make geo-import`, public cacheable geo endpoints, §19 snapshot → {country,state,municipality}.
- **S11.** Q1 «Sí, usarlo así (Recomendado)» — SEPOMEX only to autocomplete state/municipality from one postal code at a time, no bulk listing, no resale. Q2 keep `applicant_country`. Q3 postal code preloads (editable, never locked).
- **S10.** Vacancy SEO stays last (pipeline-customization S27) and consumes this.

## Tasks

- [x] T1 — S1–S11: §20 design, frontend review, Q1 user answer (parent) — 3bdee90 + decisions commit
- [ ] T2 — S1, S4, S9: G1 catalog + importer + geo endpoints, migration 00030 own commit (worker)
- [ ] T3 — S2, S3, S5, S8: G2 vacancy location + remote scope + projection, migration 00031 own commit (worker)
- [ ] T4 — S2, S6, S8: G3 candidate profile + company, migration 00032 own commit (worker)
- [ ] T5 — S3, S6, S9: G4 apply country gate + §19 snapshot/board, migration 00033 own commit (worker)
- [ ] T6 — S7: G5 public search filters (worker)

## Log

- **L1.** Frontend relay of the user's feature request and answers (S1–S9, verbatim above); queue rows 10–11 approved and merged (main d3d6671, then the user's logo commit ef75173).
- **L2.** Code map (explore mvfsgwt6-e-v9iq): drafts store `location`/`work_mode` inside the BYTEA canonical document (draftfields/scalars.go:48–74; readiness.go:26–40 requires location even for remote); projection 00020 `location TEXT NOT NULL`; /v2/jobs `location` substring filter (public_jobs.sql); candidate `/me/profile` city/country text (00006); company city/country (00003, PATCH tri-state); §19 snapshot city (00029); apply tx store.go:41–136 has no country gate; legacy `jobs` table and `/jobs` routes still live; latest migration 00029. SEPOMEX note: «se proporciona en forma gratuita, no estando permitida su comercialización, total o parcial» (correosdemexico.gob.mx).
- **L3.** Frontend accepted §20; Q1 user answer, Q2/Q3 frontend answers recorded in §20.9 (S11). G1 starts on `feat/geo-catalog`.

# Org candidates (backend) — «Candidatos de mi organización» v1

Backend half of SRCH-2/SRCH-3 (docs/recruitment-business-rules.md §12): recruiter-facing list and detail of the company's internal candidate pool.
Branch feat/org-candidates from main 594ae7b; frontend pairs on feat/team-and-org-candidates-ui. Merge on user say, push by user.

## Specs

- **S1** (L1, L2). Next unit: «Candidatos de mi organización (Recomendado)» — «DB interna real: candidatos manuales + postulantes a tus vacantes, tabla y tarjetas, filtros del perfil armonizado y detalle con sus procesos. Endpoints nuevos de backend. Ediciones auditadas en un segundo corte.»
- **S2** (L2). Access: «Todos los de la organización (Recomendado)» — «Cualquier reclutador de la empresa ve todo el pool interno. Simple, y la restricción por vacante se puede agregar cuando definamos colaboradores.»
- **S3** (L3). The UI needs: table and cards over the same results, total count, order (most recent first?), the board's filters (location state/municipality, minimum education + in progress, seniority, years by buckets, languages + minimum level, vacancy, origin manual/organic, q name/email); detail with contact, harmonized profile (the board's six-key shape), CV(s) and participations per vacancy (vacancy, current stage, status, entry date, origin).
- **S4**. SRCH-7 and privacy: recruiter-created internal records and organization-private data never leave the company; organic data follows the board's privacy (no birth date or salary; contact only on detail).

## Tasks

- T1 [done] S1-S4 | parent + explore | Map data model and reuse; draft contract backend/docs/org-candidates.md; frontend review before code. | commit: 3bd5597, d9d8b7e
- T2 [in_progress] S1-S4 | worker mvj332lb-2-k5td | GET /v2/me/company/candidates (list, filters, cursor, total). | commit: -
- T3 [pending] S1-S4 | TBD | GET /v2/me/company/candidates/{kind}/{id} + CV download (detail, participations, CVs). | commit: -
- T4 [pending] S1-S4 | parent | Full checks, docs, integration with frontend, user review. | commit: -

## Log

- **L1.** User (2026-10-21, after the follow-ups push), choosing the next big unit: «Candidatos de mi organización (Recomendado)». Equipo with real members is done by the frontend in parallel (existing endpoints).
- **L2.** User access rule: «Todos los de la organización (Recomendado)». Relayed identically by the frontend: «(1) «Candidatos de mi org v1 (recomendado)»; (2) acceso: «Todos los de la organización» (cualquier reclutador de la empresa ve todos los candidatos internos: altas manuales y postulantes de cualquier vacante de la empresa).»
- **L3.** Frontend UI needs (verbatim): «tabla y tarjetas sobre los mismos resultados, contador total, orden (¿más recientes primero?), los mismos filtros que el tablero (ubicación estado/municipio, estudios mínimos + en curso, seniority, años por rangos, idiomas + nivel mínimo, vacante, origen manual/orgánico, q nombre/correo) y en el detalle: contacto, perfil armonizado (mismo shape de 6 claves del tablero), CV(s) y participaciones por vacante (vacante, etapa actual, estado, fecha de ingreso, origen).»
- **L4.** Exploration (mvj2vksk-1-ja1i): pool union mirrors board/duplicates.go:15-35; identity (kind, id) with kind manual|organic; organic profile must come from a frozen participation snapshot (no canonical per-company organic profile), chosen as the most recent participation; board authorization is owner-or-principal and must NOT be reused (S2); list cursors adapt draftlist/publicjobs patterns.
- **L5.** Frontend contract review (verbatim summary of its 8 points): lifecycle state on latest_participation.vacancy; professional_title/current_company; created_by on manual detail; discard reason; confirm `native` lowercase; no facets, single order; `vacancy` not found code; «Cargar más» with next_cursor, default 20. Applied in d9d8b7e: lifecycle is the real pair {publication, process}; professional_title/current_company null for organic (snapshot lacks them); discard {reason, comment, discarded_at} separate from substate {id,name}; `applied_at` naming as on the board; vacancy → invalid_filter {field:"vacancy", code:"not_found"}. Frontend: «lo apruebo con estos ajustes».

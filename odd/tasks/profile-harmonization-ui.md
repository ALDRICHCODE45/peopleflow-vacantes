# Profile, intake and vacancy harmonization (UI)

Frontend side of the system-wide harmonization of languages, seniority, years of experience and
education (INT-29). Branch `feat/profile-harmonization-ui`, stacked on `feat/manual-intake-ui`
(1663cbc). Backend counterpart: session 01a15cf9-39e8. Nothing merges to main without the user's word.

## Specs

- **S1** (user L1, L2). Languages «en todo el sistema en general, no solo en los candidatos, en todo»: a broad ISO catalog («Catálogo amplio ISO con buscador»: ~180 languages with Spanish names, including Mexican Indigenous languages), chosen with a searchable combobox, never free text.
- **S2** (user L2). Language level «A1–C2 + Nativo»: `A1`, `A2`, `B1`, `B2`, `C1`, `C2`, `Nativo`.
- **S3** (user L1, L2). Seniority «De practicante a director»: Practicante / Junior / Semi-senior / Senior / Líder / Gerente / Director, separate from «Años de experiencia» (decimal, e.g. 1.5; in the vacancy a minimum, never a cap).
- **S4** (user L2). Education levels «Sistema mexicano completo»: Secundaria, Bachillerato/Preparatoria, Carrera técnica, Técnico Superior Universitario (TSU), Licenciatura/Ingeniería, Especialidad, Maestría, Doctorado.
- **S5** (user L1, L2). Several studies per candidate («Varios estudios»): level, institution, field, status and optional dates; status «en curso / en pausa / concluido / trunco»; an ongoing study never counts as completed; filters use the highest completed level and, separately, ongoing studies.
- **S6** (INT-22, INT-29). The vacancy states languages with minimum level, seniority, minimum years and minimum education level plus whether it accepts ongoing studies; requirements inform and filter, never auto-reject.
- **S7** (user L1). «esto nos puede servir para filtrar mucho mejor la información»: the pipeline board filters and profile display use the new fields.

## Tasks

- [ ] T1 — S1–S7: agree the contract with the backend (catalog endpoint, profile/intake/vacancy shapes, migration of existing data, board profile snapshot and filters) — route: intercom — commit: —
- [ ] T2 — S1, S2: shared language catalog combobox + level select (reused everywhere) — route: worker — commit: —
- [ ] T3 — S3–S5: candidate profile (seniority, decimal years, several studies with status) — route: worker — commit: —
- [ ] T4 — S1–S5: manual intake form parity — route: worker — commit: —
- [ ] T5 — S6: vacancy requirements in the editor and public detail — route: worker — commit: —
- [ ] T6 — S7: board profile display and filters — route: worker — commit: —
- [ ] T7 — browser QA (function + design, light/dark/mobile), docs, review queue — route: inline — commit: —

## Log

- **L1.** User: «Bien hermano, respondiendo a tu pregunta sobre el nuevo corte de "armonizacion" de la vacante, si, esoty de acuerdo, hay que hacerlo ahora, pero hay que contemplar mas cosas, porque es algo que de hecho vengo pensando demasiado, el heco de ampliar los idiomas en todo el sytema en general, no solo en los candidatos, en todo, quiero que haya una lista mucho mas extensa de idiomas, con un nivel especifico que ya tenemos, esos no los cambiaria, el seniority y anos de experiencia tambien los meteria, junto con su estado " en curso, en pausa, etc.." esto nos puede servir para filtrar mucho mejor la informacion.»
- **L2.** Answers: level «A1–C2 + Nativo (Recomendado)»; catalog «Catálogo amplio ISO con buscador (Recomendado)»; status «Estudios con estado (Recomendado)»; seniority «De practicante a director (Recomendado)»; education «Sistema mexicano completo (Recomendado)»; «Varios estudios (Recomendado)». Recorded as INT-29 in docs/recruitment-business-rules.md.

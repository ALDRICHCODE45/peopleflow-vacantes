# Profile harmonization (INT-29) — backend

Backend side of the system-wide harmonization of languages, seniority, years of experience and education, with the frontend (`odd/tasks/profile-harmonization-ui.md`).
Branch `feat/profile-harmonization` stacked on `feat/manual-intake` 14a4439. Design: `docs/profile-harmonization-design.md`. Nothing to main; merge on the user's word, push by the user.

## Specs

- **S1** (INT-29, verbatim): «**system-wide** (candidate profile, recruiter intake, vacancy requirements, filters and search) languages come from a broad ISO catalog with Spanish names (including Mexican Indigenous languages), chosen from a searchable list, never free text; each language has a level on the CEFR scale `A1`, `A2`, `B1`, `B2`, `C1`, `C2` plus `Nativo`. Seniority levels: `Practicante`, `Junior`, `Semi-senior`, `Senior`, `Líder`, `Gerente`, `Director`, separate from years of experience (decimal, e.g. `1.5`; a minimum in vacancies). Education levels follow the Mexican system: `Secundaria`, `Bachillerato/Preparatoria`, `Carrera técnica`, `Técnico Superior Universitario (TSU)`, `Licenciatura/Ingeniería`, `Especialidad`, `Maestría`, `Doctorado`. A candidate may record several studies (level, institution, field, status and optional dates) with status `en curso`, `en pausa`, `concluido` or `trunco`; an ongoing study never counts as a completed qualification. The vacancy states a minimum education level and whether it accepts ongoing studies.»
- **S2** (frontend relay of the user's decisions): vacancy requirements «Informan y filtran, nunca rechazan (INT-22)»; manual intake «exigir ≥1 estudio (INT-8)»; test-data migration best effort.

## Tasks

- [ ] T1 — S1–S2: contract with exact JSON (`docs/profile-harmonization-design.md`) agreed with the frontend — pending
- [ ] T2 — H1: language catalog + candidate profile (migration own commit) — pending
- [ ] T3 — H2: manual intake fields — pending
- [ ] T4 — H3: vacancy requirements + public exposure — pending
- [ ] T5 — H4: participation snapshot + board filter data — pending

## Log

- **L1.** Frontend request (intercom 429e6688, 2026-10-21): new cut decided by the user (INT-29); proposal of catalog route, shapes and H1–H4 cuts; asked for exact JSON before launching workers.
- **L2.** Code map (explore mvikyl1z-k-zuc2): vacancy draft already has `seniority` intern|junior|mid|senior|lead and `languages` {language es|en|other, custom_name, level basic..native}; no education/experience requirement; draft canonical JSON accepts integers only; profile key `years_of_experience` SMALLINT, `education_level`+`field_of_study`, `candidate_languages` free text + CEFR; manual intake `experience_years`; snapshot CHECK exact keys {location,skills,years_of_experience,education_level}; legacy `jobs.seniority` and `/jobs` filter; traceability manifest pins profile fields.
- **L3.** Proposal sent: English literals (`intern`…`director`, education levels, statuses, `native`), decimal years as strings with one decimal, key `years_of_experience` everywhere, catalog `GET /v2/catalogs/languages` embedded and cacheable, education records with ≥1 required in manual intake, vacancy `languages[{code,min_level}]`, `min_years_of_experience`, `min_education_level`, `accepts_in_progress_education`, snapshot `education {highest_completed,in_progress}` + seniority + languages, explicit migration mapping, public filters out unless requested.

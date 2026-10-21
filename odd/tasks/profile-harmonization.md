# Profile harmonization (INT-29) — backend

Backend side of the system-wide harmonization of languages, seniority, years of experience and education, with the frontend (`odd/tasks/profile-harmonization-ui.md`).
Branch `feat/profile-harmonization` stacked on `feat/manual-intake` 14a4439. Design: `docs/profile-harmonization-design.md`. Nothing to main; merge on the user's word, push by the user.

## Specs

- **S1** (INT-29, verbatim): «**system-wide** (candidate profile, recruiter intake, vacancy requirements, filters and search) languages come from a broad ISO catalog with Spanish names (including Mexican Indigenous languages), chosen from a searchable list, never free text; each language has a level on the CEFR scale `A1`, `A2`, `B1`, `B2`, `C1`, `C2` plus `Nativo`. Seniority levels: `Practicante`, `Junior`, `Semi-senior`, `Senior`, `Líder`, `Gerente`, `Director`, separate from years of experience (decimal, e.g. `1.5`; a minimum in vacancies). Education levels follow the Mexican system: `Secundaria`, `Bachillerato/Preparatoria`, `Carrera técnica`, `Técnico Superior Universitario (TSU)`, `Licenciatura/Ingeniería`, `Especialidad`, `Maestría`, `Doctorado`. A candidate may record several studies (level, institution, field, status and optional dates) with status `en curso`, `en pausa`, `concluido` or `trunco`; an ongoing study never counts as a completed qualification. The vacancy states a minimum education level and whether it accepts ongoing studies.»
- **S3** (user via frontend): public search filters by «Idioma, seniority, años y estudios» in this cut; legacy vacancies without data are excluded for language/seniority and included for years/education ("what I have").
- **S2** (frontend relay of the user's decisions): vacancy requirements «Informan y filtran, nunca rechazan (INT-22)»; manual intake «exigir ≥1 estudio (INT-8)»; test-data migration best effort.

## Tasks

- [x] T1 — S1–S3: contract with exact JSON (`docs/profile-harmonization-design.md`) agreed with the frontend — 07494cd + this commit (L4)
- [ ] T2 — H1: language catalog + candidate profile (migration own commit) — pending
- [ ] T3 — H2: manual intake fields — pending
- [ ] T4 — H3: vacancy requirements + public exposure — pending
- [ ] T5 — H4: participation snapshot + board filter data — pending
- [ ] T6 — S3 / H5: public search filters language, seniority, years_of_experience, education_level — pending

## Log

- **L1.** Frontend request (intercom 429e6688, 2026-10-21): new cut decided by the user (INT-29); proposal of catalog route, shapes and H1–H4 cuts; asked for exact JSON before launching workers.
- **L2.** Code map (explore mvikyl1z-k-zuc2): vacancy draft already has `seniority` intern|junior|mid|senior|lead and `languages` {language es|en|other, custom_name, level basic..native}; no education/experience requirement; draft canonical JSON accepts integers only; profile key `years_of_experience` SMALLINT, `education_level`+`field_of_study`, `candidate_languages` free text + CEFR; manual intake `experience_years`; snapshot CHECK exact keys {location,skills,years_of_experience,education_level}; legacy `jobs.seniority` and `/jobs` filter; traceability manifest pins profile fields.
- **L3.** Proposal sent: English literals (`intern`…`director`, education levels, statuses, `native`), decimal years as strings with one decimal, key `years_of_experience` everywhere, catalog `GET /v2/catalogs/languages` embedded and cacheable, education records with ≥1 required in manual intake, vacancy `languages[{code,min_level}]`, `min_years_of_experience`, `min_education_level`, `accepts_in_progress_education`, snapshot `education {highest_completed,in_progress}` + seniority + languages, explicit migration mapping, public filters out unless requested.
- **L4.** Frontend accepted points 1–4, 6, 7 (`intern` literal, «Practicante» label). User chose public search by language, seniority, years and education → H5 after H3. Backend adjusted: repeated `language` combines with OR (consistency with every other public multi-value filter; AND is a trivial change if the user prefers), keys `years_of_experience` and `education_level` instead of `max_min_years`/`education`; legacy seniority matches through the mid→semi_senior mapping.
- **L5.** H1a worker caught wrong code examples in §2 (`nah` is an ISO 639-2 collective, `mix` is Mixtepec Mixtec). Code policy fixed: 639-1 → 639-3 (individual/macrolanguage) → 639-2/639-5 collective → local-use `qaa`–`qtz` for INALI groupings without any ISO code; codes are opaque to clients.
- **L6.** H1a done (worker mvil6tyv-l-zh35 / mvilbm9j-m-ezt6): backend/internal/shared/languages (197 entries, vocabularies, comparisons, years validator; canonical years drop a zero fraction: `2.0` → `2`), `GET /v2/catalogs/languages` (anonymous, public 1-day cache, strong ETag, 304), docs backend/docs/language-catalog.md. Local-use codes qaa–qaq for INALI groupings that ISO only splits into varieties (Mixteco, Otomí, Totonaco, Mazateco, Mazahua, Tlapaneco, Chinanteco, Purépecha — ISO splits tsz/pua —, Mixe, Tarahumara, Zoque, Amuzgo, Chatino, Tepehuano, Triqui, Popoluca, Cora). RED observed; `go test ./...` incl. closure, archguard, vet both tags green. No DB involved.
- **L7.** H1b-1 collision policy (parent decision, best effort per S2): legacy names of one user mapping to the same code keep the highest CEFR level; collapsed rows are reported by the migration.

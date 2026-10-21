# Profile harmonization (INT-29) — backend contract proposal

Status: **proposal for frontend review**. Rule: `docs/recruitment-business-rules.md` INT-29.
Backend branch `feat/profile-harmonization`, stacked on `feat/manual-intake`.
Frontend: `odd/tasks/profile-harmonization-ui.md` on `feat/profile-harmonization-ui`.

## 1. Shared vocabularies

| Concept | Wire literals (exact, never trimmed or case-folded) |
| --- | --- |
| Language level | `A1` `A2` `B1` `B2` `C1` `C2` `native` |
| Seniority | `intern` `junior` `semi_senior` `senior` `lead` `manager` `director` |
| Education level (ordered) | `secondary` < `high_school` < `technical` < `tsu` < `bachelor` < `specialty` < `master` < `phd` |
| Education status | `in_progress` `paused` `completed` `incomplete` |

Spanish labels belong to the frontend (Practicante, Junior, Semi-senior, Senior, Líder,
Gerente, Director; Secundaria, Bachillerato/Preparatoria, Carrera técnica, TSU,
Licenciatura/Ingeniería, Especialidad, Maestría, Doctorado; En curso, En pausa,
Concluido, Trunco; Nativo). Identifiers stay English like every other enum.

**Years of experience** is a decimal **string** everywhere: `^(0|[1-9][0-9]?)(\.[0-9])?$`,
value 0–60 (`"0"`, `"1.5"`, `"60"`; `"60.5"`, `"01"`, `"1.50"` rejected). Strings avoid
binary floating point and the draft JSON canonicalizer, which accepts integers only.
The key is `years_of_experience` everywhere (manual intake's `experience_years` is
renamed before it ever reaches main).

**Highest completed level** = the highest `level` among records with
`status: "completed"`; null if none. `in_progress` never counts as completed.

## 2. Language catalog

`GET /v2/catalogs/languages` — anonymous, `Cache-Control: public, max-age=86400`,
strong ETag, 304 on `If-None-Match`.

```json
{"items":[{"code":"de","name":"Alemán"},{"code":"es","name":"Español"},{"code":"nah","name":"Náhuatl"},{"code":"yua","name":"Maya yucateco"}]}
```

- `code`: ISO 639-1 when it exists, otherwise ISO 639-3 (macrolanguage code where one
  exists, e.g. `nah`, `zap`, `mix`). Lowercase ASCII, 2–3 letters. Unique.
- `name`: Spanish, NFC. Sorted by Spanish collation of `name`, then `code`.
- About 180 entries, including the Mexican Indigenous languages with INALI-recognized
  families (Náhuatl, Maya yucateco, Tseltal, Tsotsil, Mixteco, Zapoteco, Otomí,
  Totonaco, Ch'ol, Mazateco, Huasteco, Mazahua, Tlapaneco, Chinanteco, Purépecha,
  Mixe, Tarahumara, Zoque, Tojolabal, Chontal de Tabasco, Huichol, Amuzgo,
  Chatino, Tepehuano, Triqui, Popoluca, Cora, Yaqui, Mayo, Seri, among others).
- Embedded in the binary (no table edits at runtime). Every write that carries a
  language code validates membership; an unknown code is a field error `invalid`.

## 3. Candidate profile (H1)

`GET/PUT /me/profile/` keeps its routes. Changes to the profile body:

- `years_of_experience`: decimal string or null (was integer).
- New `seniority`: literal or null.
- Removed: `education_level`, `field_of_study` (moved into education records).
- New `education`: array (≤ 10) of records, full replacement on PUT.

```json
{"years_of_experience":"1.5","seniority":"junior",
 "education":[
  {"level":"bachelor","institution":"UNAM","field":"Ingeniería en Computación","status":"completed","start_year":2015,"end_year":2020},
  {"level":"master","institution":null,"field":null,"status":"in_progress","start_year":2024,"end_year":null}],
 "…other existing profile keys unchanged…":"…"}
```

Education record: exactly `{level, institution, field, status, start_year, end_year}`;
`institution`/`field` trimmed, 1–120 code points or null; years integers 1950–2100 or
null; when both present `start_year <= end_year`; `status: "completed"` may omit
`end_year`; `in_progress` must have `end_year: null`. Duplicates allowed (two
bachelor's degrees are legitimate).

`GET/PUT /me/profile/languages/` changes shape:

```json
{"languages":[{"code":"es","level":"native"},{"code":"en","level":"B2"}]}
```

≤ 10, unique `code`, catalog membership, level from §1.

Field errors use the shared `400 validation_error` with `fields`
(`education[1].status`, `languages[0].code`, `years_of_experience`), as manual intake.

## 4. Manual intake (H2)

`candidate` in `POST …/pipeline/candidates/manual` changes:

- `education_level`, `field_of_study` removed; **`education` required with ≥ 1 record**
  (INT-8), same record shape as §3.
- `experience_years` → `years_of_experience` (decimal string or null).
- New `seniority` (literal or null).
- `languages`: `[{"code","level"}]` as §3.

Duplicates-check and the contact/detail contract are unchanged.

## 5. Vacancy requirements (H3)

Draft v2 `fields` changes (schema version stays 2; migration rewrites drafts):

```json
{"seniority":"semi_senior",
 "languages":[{"code":"en","min_level":"B2"}],
 "min_years_of_experience":"2",
 "min_education_level":"bachelor",
 "accepts_in_progress_education":true}
```

- `seniority`: new vocabulary or null.
- `languages`: ≤ 20, unique `code`, `min_level` from §1 (replaces
  `{language,custom_name,level}`).
- `min_years_of_experience`: decimal string or null.
- `min_education_level`: education level or null; `accepts_in_progress_education`:
  boolean, default `false`, only meaningful when a minimum is set.
- None of these block publication (INT-22: inform and filter, never reject).
- Public detail and list items expose `seniority` and a new `requirements_profile`
  `{languages, min_years_of_experience, min_education_level, accepts_in_progress_education}`.
  Public search filters on these dimensions are **not** in this cut unless requested.

## 6. Board snapshot and filters (H4)

Participation `profile` (snapshot for organic, live record for manual — unchanged rule):

```json
{"location":{…},"skills":["Go"],"years_of_experience":"1.5","seniority":"junior",
 "education":{"highest_completed":"bachelor","in_progress":true},
 "languages":[{"code":"en","level":"B2"}]}
```

`education.in_progress` is true when any record is `in_progress`. The board's
client-side filters gain seniority, languages (code + minimum level, CEFR order with
`native` highest) and education (highest completed ≥ X, optionally counting
in-progress), and experience buckets become decimal-aware.

## 7. Data migration (dev data; Risk item 1)

| Source | Target |
| --- | --- |
| `candidate_profiles.years_of_experience` SMALLINT | NUMERIC(3,1) → string on wire |
| `candidate_profiles.education_level` + `field_of_study` | one record `{level, field, status:"completed"}` (old literals keep their name) |
| `candidate_languages.language` free text | code via exact Spanish/English name match (case/accents-insensitive) against the catalog; unmatched rows dropped and counted in the migration log |
| `company_candidates` (unmerged branch) | same as profiles |
| Draft `seniority` `intern`, `junior`, `mid`, `senior`, `lead` | `intern`, `junior`, `semi_senior`, `senior`, `lead` |
| Draft `languages` `{language: es, en or other, …}` | `es`/`en` kept with level `basic→A2`, `intermediate→B1`, `advanced→C1`, `native→native`, null level dropped; `other` → catalog match on `custom_name` or dropped |
| Projections, participation snapshots | rebuilt from the migrated sources |

Legacy `jobs.seniority` (v1) is untouched; the public v2 UNION maps legacy `mid` to
`semi_senior` in its output.

## 8. Cuts

H1 catalog + profile · H2 manual intake · H3 vacancy + public exposure · H4 snapshot +
board filters. Each cut: migration in its own commit, contract test map in its doc.

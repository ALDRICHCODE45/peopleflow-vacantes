# Base de talento: País and active-process filters, corrected rows, CSV with contact

Branch `feat/talent-filters-export` from `main` @ 81144cc9. Closes the open items of `talent-base-redesign.md` L11
(except the Checkbox primitive). Backend + frontend in this clone.

## Specs

- **S1.** «Los filtros faltantes hay que integrarlos por favor» → the talent list offers the «País» filter and the
  «Solo procesos activos» filter, applied server-side over the whole pool.
  - `country`: repeatable ISO country id from the geo catalog, or `none` («Sin dato»); unknown country → 400
    `invalid_filter` `{field:"country",code:"invalid"}`.
  - `active_process=true`: only candidates with `participations.active >= 1` (same rule as the counter and the summary
    metric: not discarded, process not finished). Any other value → `invalid`; duplicate → `duplicate`.
- **S2.** «tambien lo de las filas corregidas» → each list item carries `corrected_fields` (sorted keys of the company's
  corrections; `[]` for manual and uncorrected organic), so the row shows «Corregido» without opening the sheet.
- **S3.** «y tambien el punto 1, csv hay que arreglarlo» — point 1 was «CSV: no trae columnas de email ni de teléfono, y
  algunas celdas juntan dos datos, por ejemplo «4.5 años · Senior» o «hace 1 día»». → the CSV has «Email» and «Teléfono»
  columns and one value per cell (no joined values, no relative dates).
  - User decision (contact source): «Endpoint de exportación» — the list stays without contact; a backend endpoint
    receives the selected ids and returns their contact with corrections applied.
- **S4.** «solo eso» → nothing else in this unit.

## Contract (parent decisions, binding for backend and frontend)

- **C1 list filters.** `country` repeatable, exactly two uppercase letters present in `geo_countries`, or `none`
  (missing `profile.location` country); matched on the effective profile (`profile#>>'{location,country}'`), like
  `state`. Bad format → `{field:"country",code:"invalid"}` from ParseQuery; well-formed but not in the catalog →
  `{field:"country",code:"invalid"}` from the catalog check. `active_process` single, only `true` is valid → filter
  `active >= 1`. Both enter the cursor filter hash. Docs: `backend/docs/org-candidates.md` filters table.
- **C2 list item.** New key `corrected_fields: string[]` (sorted keys of `company_candidate_corrections.corrections` for
  organic; `[]` for manual or no corrections). Doc example and bullets updated.
- **C3 contacts export.** `POST /v2/me/company/candidates/contacts`, gates `NoStore → RequireAuth → requireRecruiter`
  (same as the list), body `{"candidates":[{"kind":"manual"|"organic","id":"<uuid>"}]}` strict JSON (unknown
  keys/trailing data rejected), 1–100 entries, no duplicates, body ≤ 16 KiB. 200
  `{"items":[{"kind","id","email":string|null,"phone":string|null}]}` in request order, only candidates in this
  company's pool (same identity set as the list: manual of the company, organic with a participation in the company);
  others are omitted, never an error (no existence oracle beyond the list). Effective contact: manual live
  `company_candidates.email/phone`; organic `users.email` + `NULLIF(btrim(candidate_profiles.phone),'')` with the
  company's corrections applied (`email`/`phone` keys, JSON null clears), same as the detail. Errors: 400
  `validation_error` with `fields` (`candidates` `required`|`too_many`|`duplicate`, `candidates[i].kind`/`.id`
  `invalid`), 400 `invalid_json` for malformed/oversized body (reuse the existing decoder helper and codes if they
  differ), 401/403 as the list; all with `Cache-Control: no-store`. No pagination.
- **C4 CSV.** Columns follow the visible table columns in order; each column group expands to single-value columns:
  candidate → «Nombre», «Puesto», «Origen», «Email», «Teléfono»; location → «Municipio», «Estado», «País»;
  experience → «Años de experiencia» (raw decimal, e.g. `4.5`), «Seniority»; education → «Estudios concluidos»,
  «Estudios en curso»; languages → «Idiomas» (one list cell, `Inglés C1; Español Nativo`); vacancy → «Última vacante»,
  «Etapa», «Estado en la vacante» (Activo/Descartado), «Publicación» (Publicada/Pausada/Cerrada/Sin publicar),
  «Proceso de la vacante» (Activo/Finalizado/empty); processes → «Procesos», «Procesos activos» (integers); activity →
  «Última actividad» (`YYYY-MM-DD`, America/Mexico_City). Missing values are empty cells. If the candidate column is
  hidden, «Email»/«Teléfono» still come first. Contact comes from C3 (chunks of 100, server action); if it fails,
  nothing downloads and the user sees «No pudimos obtener el contacto de los candidatos. Intenta de nuevo.»; the
  export button is disabled with a spinner while it runs. Formula neutralization and BOM stay.

## Tasks

- T1 Backend list: `country` + `active_process` filters, `corrected_fields` in items, docs — S1, S2, C1, C2 — backend worker — commit
- T2 Backend contacts export endpoint + docs — S3, C3 — backend worker — commit
- T3 Frontend filters País + «Solo procesos activos» — S1, C1 — frontend worker — commit
- T4 Frontend list `corrected_fields` on rows — S2, C2 — frontend worker — commit
- T5 Frontend CSV split columns + contact via export endpoint — S3, C3, C4 — frontend worker — commit
- T6 Browser QA, suite, verify (contact export = security), native review per RDD — S1–S4

## Log

- **L1.** User (2026-10-22): «Los filtros faltantes hay que integrarlos por favor. tambien lo de las filas corregidas, y
  tambien el punto 1, csv hay que arreglarlo. solo eso.»
- **L2.** Evidence: `backend/docs/org-candidates.md` «No contact (email/phone) in list items, as on the board; contact is
  detail-only.» Asked the user; answer: «Endpoint de exportación (Recomendado)».
- **L3.** Integration DB: `DRAFT_TEST_DATABASE_URL='postgres://admin:secreto@127.0.0.1:5432/draft_test?sslmode=disable'`
  (container `peopleflow-vacancies`; the old 32770 DSN is gone).
- **L4.** Context backstop reached (151k): backend (T1–T2) and frontend (T3–T5) delegated to two background workers
  with disjoint surfaces (`backend/**` vs `frontend/**`); workers do not commit, the parent commits per task.
- **L5.** T1+T2 done (worker mvkc88ou-1-j5jk): RED route 9/20 + SQL 9/1 → GREEN; parent re-ran integration
  `TestOrgCandidates` 282 PASS and focused packages ok; worker ran full `go test ./...`, vet, gofmt. Deviation: existing
  decoder codes (400 `invalid_request`, 413 `payload_too_large`) instead of `invalid_json`. Commit a428d890 (one commit
  for T1+T2: they share pool.go, routes and the flow test; 705 lines, mostly tests — slice boundary recorded here).
  Note: old list cursors become `invalid_cursor` (filter hash changed); the UI already restarts on that.
- **L6.** Independent verify (mvkcyjo2-3-pb18) of a428d890: PASS S1/C1, S2/C2, S3/C3 backend, no blocking findings
  (tenant isolation, gates, detail parity, bounds, sanitized errors); unit + integration re-run green.
- **L7.** T3–T5 (worker mvkc88ov-2-mqnw): RED→GREEN per task; org-candidates 454 tests, tsc, lint 0 errors. T3
  committed cc68892a. Browser QA (parent, QA API `/tmp/peopleflow-api-talent-filters` on :8080, dev server :3000):
  country=CO 1 + MX 2 + none 1 = 4 total; active_process=true 4; CO+active 1; chips «País: Colombia», «Solo procesos
  activos: Sí»; picking from the combobox writes `country=CO`, then `state=14`; 390 px panel ok
  (`.playwright-mcp/qa/tf-*.png`). Corrected organic row shows «Datos corregidos por tu empresa» on a fresh load.
  CSV of 4 selected rows: exact C4 header, contact present (corrected values for the organic candidate), one value per
  cell, empty cells, `YYYY-MM-DD`. Note for the user: phones starting with `+` export as `'+52…` (existing formula
  neutralization; Excel hides the apostrophe).
- **L8.** Close: full frontend suite 400 files / 7126 tests (exit 0). T4+T5 committed bdbfabff (shared
  `candidate-values.ts` and tests). Native assess on the committed range 81144cc9..HEAD (35 paths, 1187 lines): risk
  medium, `reviewDue: false` (under budget) → no native review; the contacts endpoint already had the independent
  verify (L6). Not merged: branch `feat/talent-filters-export` waits for the user. QA API binary
  `/tmp/peopleflow-api-talent-filters` left running on :8080 (replaced the summary build).
- **L9.** Native review lineage review-58d016885d239061 (lenses risk + reliability, range 81144cc9..cff220d1): the
  review-reliability reviewer returned no text twice through the Pi host relay (first `stopReason: length` after 32k
  reasoning tokens, then an empty `stop`); STATUS re-offered the same group once and it failed again → not retried,
  no verdict; left open for the user.
- **L10.** User (2026-10-22): «si hermano, pero las cards de la seccion de "Base de Talento" no son las mismas que las
  cards propuestas de v0 […] revisa el chat de todos modos por favor.» The v0 chat has one exchange; the card is the
  `talent-card` in `docs/design/v0/base-de-talento/components/peopleflow/workspace.tsx.txt` + `app/globals.css.txt`.
  Decision (ask_user_question): «v0 + casilla (Recomendado)» → v0 card (avatar + ↗, name, title, «location · years»,
  language/origin tags, footer vacancy + stage; whole card opens the ficha) keeping a discreet selection checkbox; no
  «…» menu in cards. Test-first: RED 3 → GREEN; org-candidates 452 tests, tsc and eslint clean. Browser: 1440 light/dark,
  390 (`.playwright-mcp/qa/tf-cards-*.png`); dark tags get `dark:border-border` because `--muted` equals the card tone.
- **L11.** Native review lineage review-08a5bac5ae3551b3 on 81144cc9..1bc2d91d (36 paths, 1317 lines, includes the
  cards), lens risk only (the reliability relay had failed twice on this size): approved with no findings and
  acknowledged (authority burned). The earlier lineage review-58d016885d239061 stays open without a verdict for the
  superseded target.

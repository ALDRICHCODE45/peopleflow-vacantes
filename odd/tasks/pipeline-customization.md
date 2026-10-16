# Pipeline customization

Backend side of per-vacancy pipeline customization, delivered cut by cut with the frontend agent.
Branch `feat/pipeline-config` (from main a39e5ca). Design and cut-1 contract: `docs/pipeline-customization-design.md`. Business rules: `docs/recruitment-business-rules.md` §5, §5.1, §6.

## Specs

- **S1.** «quiero que lo hagamos lento porque tengo prisa, me explico? a nuestro paso, tranquilos, disenando todo bien, entre tu y el agente del frontend, deben coordinarse para sacar feature a feature de forma rapida pero segura.»
- **S2.** «Si hermano, arrancamos ya con eso.» — approved start of step 0: joint design of the model and contract for cut 1 with the frontend agent, no code.
- **S3.** Delivery rules in force: no PRs; local merge to `main` only after the user's real browser test; the user pushes.
- **S4.** Q1 «Solo renombrar y reordenar (Recomendado)» — built-in columns Nuevos, Screening and Screening OK are never removed.
- **S5.** Q2 «Sí, únicos (Recomendado)» — «No puede haber dos columnas «Entrevista» en el mismo tablero.»; compared ignoring case and surplus whitespace, preserving accents.
- **S6.** Q3 «Nuevos siempre primera (Recomendado)» — «Se reordena todo lo que está entre Nuevos y Placement.»

- **S7.** Cut 2 (user, 2026-10-16): «Bien hermano, coordinate con el backend para dar inicio a los siguientes pasos por favor.» (relayed by frontend agent msg 88c7cf5b).
- **S8.** Cut 2 Q1 «Techo técnico de 50 (Recomendado)»; Q2 «El que elige el reclutador (Recomendado)»; Q3 «Vacía, con sugerencias (Recomendado)»; Q4 «Sí, únicos (Recomendado)».

## Tasks

- [x] T1 — S1, S2: design proposal `docs/pipeline-customization-design.md` (inline) — d7be650
- [x] T2 — S1, S2: contract review with frontend agent (intercom); F1–F3 answered, 7 contract objections accepted — contract commit
- [x] T3 — S4–S6: user answered Q1–Q3 — contract commit
- [x] T4 — S1: cut-1 contract closed and sent to the frontend agent — contract commit
- [x] T5 — cut 1, S4–S6 + design §3: pure pipeline-config model (defaults with UUIDv5 ids, PUT decoding, invariants, requester-catalog name normalization, no-op detection) with unit tests (worker) — 0cd4110
- [x] T6 — cut 1, design §3–§4: migration 00015 (stored config, own commit, Risk item 1) + store GET/PUT in one transaction with draft authorization, If-Match, independent version, audit `JobDraftPipelineConfigured` (worker) — 81dc0ef
- [x] T7 — cut 1, design §4: HTTP GET/PUT `/v2/me/company/job-drafts/{draftId}/pipeline`, router wiring, real-router tests, `backend/docs/pipeline-config.md` (worker) — 709e746
- [x] T8 — independent verification of T5–T7 against design §3–§4 (verify) — passed, recorded in L8
- [x] T9 — S3: user browser test approved; frontend merged 87ac357, backend merged into local main (see L9)
- [x] T10 — S7, S8: cut-2 design proposal, design §7 (inline) — 204e002
- [x] T11 — S7: cut-2 contract review with frontend agent; 4 clarifications accepted — contract commit
- [ ] T12 — S8 + design §7.1: pure substate-catalog model with unit tests (worker) — commit pending
- [ ] T13 — design §7.2–§7.3: migration 00016 (own commit, Risk item 1) + store GET/PUT + audit `JobDraftSubstatesConfigured` (worker) — commit pending
- [ ] T14 — design §7.2: HTTP GET/PUT `…/pipeline/substates`, router, real-router tests, `backend/docs/pipeline-substates.md` (worker) — commit pending
- [ ] T15 — parent integration run on isolated DB + independent verification — pending
- [ ] T16 — S3: user browser test with frontend, then local merge to main — pending

## Log

- **L1.** User (2026-10-15): «Si hermano, creo que lo que hay que tomar ahora es el tema de la personalizacion del pipeline, y esto es algo que va a requerir mucho trabajo, porque lo tenemos todo documentado, y quiero que lo hagamos lento porque tengo prisa, me explico? a nuestro paso, tranquilos, disenando todo bien, entre tu y el agente del frontend, deben coordinarse para sacar feature a feature de forma rapida pero segura. sabes de que te hablo? ya tienes ubicado la documentacion donde se encuentran todas las desiciones que tomamos?»
- **L2.** User (2026-10-15): «Si hermano, arrancamos ya con eso. por favor.» (after the 0–7 cut plan was proposed).
- **L3.** Evidence: the only employer vacancy entity is `job_drafts`; no draft→publish path; drafts lack cutoff/target/commitment; `applications.status` fixed CHECK (00010). Cut 1 attaches configuration to the draft. Draft GET/PATCH authorization (owner or principal) matches who may change pipeline configuration.
- **L4.** User answered Q1–Q3 with the recommended options (S4–S6).
- **L5.** Frontend agent review (msg 36b2e105): full replacement with If-Match OK; reuse draft error vocabulary (412 version_conflict, 400 validation_error, no details); string version + opaque pipeline ETag; independent draft/pipeline versions; pure GET; no-op PUT without audit; requester-catalog name normalization; Descartados renamable. All accepted. Backend choice: deterministic UUIDv5 ids for built-in stages so GET is pure and no backfill is needed.
- **L6.** Frontend agent (msg 428027ca): user confirmed the editor lives on `/empresa/vacantes/{id}/pipeline`, not in the draft editor.
- **L7.** Cut 1 backend committed: 0cd4110 model, 81dc0ef migration 00015 (additive table job_draft_pipeline_configs, ON DELETE CASCADE to job_drafts) + store + audit, 709e746 routes + docs. Parent ran sqlc generate and gofmt (worker scope gap). Evidence: `go test ./...` green, `go vet` clean; integration tests (draftstore, cmd/api, migrations) green against an isolated `draft_test` database created and dropped in the local container; every TestPipeline*/TestMigration00015 ran (no skips). Slice note: ~1.6k lines, mostly tests, past the ~400-line slice; split by work unit into three commits, migration alone. Risk: item 1 (new migration).
- **L8.** Independent verify (gentle-ai-verify mvaaij8m-2-h7lw) on c0910bc..57f75d7: no blocking functional defect; S4–S6, invariants 1–7, every §4 bullet and status code covered by code + test (integration evidence parent-run, L7); observed `go test ./...` green and `go vet` clean. Qualification: migration 00015 down drops saved pipeline configurations (documented); not a data-preserving rollback. Unverified by backend: client timeout/reconcile, browser behavior, race detector. Native review: assess on c0910bc committed range → medium, reviewDue false (under budget), not started.
- **L9.** Frontend agent (msg 9d7779e0, 2026-10-16): «El usuario aprobó el corte 1 en el navegador.» Frontend feat/pipeline-stage-config merged into local main 87ac357, no push. Editor moved to `/empresa/vacantes/{id}/configuracion/columnas` (gear on the pipeline page); contract unchanged. User decided no native review for cut 1 («entonces no la corremos, no pasa nada»). Backend feat/pipeline-config merged into local main after this entry; the user pushes. Cut 1 closed; next is cut 2 (`En proceso` substate catalog).
- **L10.** Cut 2 started on branch `feat/pipeline-substates` from main 6e237ed. User answered cut-2 questions with the recommended options (S8).
- **L11.** Frontend agent (msg 29a86067) accepted §7 with clarifications: suggestions always an array, not filtered by the server (backend choice: fixed list); strict response keys; in_process name read from GET /pipeline; empty first PUT creates version "1" with audit. All recorded in §7.2.

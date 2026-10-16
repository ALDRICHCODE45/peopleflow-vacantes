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

## Tasks

- [x] T1 — S1, S2: design proposal `docs/pipeline-customization-design.md` (inline) — d7be650
- [x] T2 — S1, S2: contract review with frontend agent (intercom); F1–F3 answered, 7 contract objections accepted — contract commit
- [x] T3 — S4–S6: user answered Q1–Q3 — contract commit
- [x] T4 — S1: cut-1 contract closed and sent to the frontend agent — contract commit
- [ ] T5 — cut 1 backend implementation (GET/PUT pipeline, migration, audit, docs) — not started; tasks opened when cut 1 starts

## Log

- **L1.** User (2026-10-15): «Si hermano, creo que lo que hay que tomar ahora es el tema de la personalizacion del pipeline, y esto es algo que va a requerir mucho trabajo, porque lo tenemos todo documentado, y quiero que lo hagamos lento porque tengo prisa, me explico? a nuestro paso, tranquilos, disenando todo bien, entre tu y el agente del frontend, deben coordinarse para sacar feature a feature de forma rapida pero segura. sabes de que te hablo? ya tienes ubicado la documentacion donde se encuentran todas las desiciones que tomamos?»
- **L2.** User (2026-10-15): «Si hermano, arrancamos ya con eso. por favor.» (after the 0–7 cut plan was proposed).
- **L3.** Evidence: the only employer vacancy entity is `job_drafts`; no draft→publish path; drafts lack cutoff/target/commitment; `applications.status` fixed CHECK (00010). Cut 1 attaches configuration to the draft. Draft GET/PATCH authorization (owner or principal) matches who may change pipeline configuration.
- **L4.** User answered Q1–Q3 with the recommended options (S4–S6).
- **L5.** Frontend agent review (msg 36b2e105): full replacement with If-Match OK; reuse draft error vocabulary (412 version_conflict, 400 validation_error, no details); string version + opaque pipeline ETag; independent draft/pipeline versions; pure GET; no-op PUT without audit; requester-catalog name normalization; Descartados renamable. All accepted. Backend choice: deterministic UUIDv5 ids for built-in stages so GET is pure and no backfill is needed.
- **L6.** Frontend agent (msg 428027ca): user confirmed the editor lives on `/empresa/vacantes/{id}/pipeline`, not in the draft editor.

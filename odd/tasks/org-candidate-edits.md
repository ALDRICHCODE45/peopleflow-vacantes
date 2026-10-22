# Org candidate edits (backend) — audited internal corrections

Cut 2 of «Candidatos de mi organización» (SRCH-4, AUD-1): every recruiter can correct any pool candidate; manual records are rewritten, organic candidates get a company-only correction layer; history and corrected CVs.
Branch feat/org-candidate-edits from main 3bd1e6f; frontend pairs on feat/org-candidate-edits-ui. Merge on user say, push by user.

## Specs

- **S1** (L1). Organic candidates are editable through a company-only correction layer: «cualquier dato del postulante debe poder modificarse, pero obviamente eso no va a modificar el perfil del candidato». Manual records are edited directly.
- **S2** (L1). Same editable fields for manual and organic: «apoco los datos del candidato manual son distintos que los de el candidato organico?? deberian ser los mismos no?» — contact (name, email, E.164 phone), location, title, current company, seniority, years, studies, languages, skills, links; manual-intake validation.
- **S3** (L1). Who edits: «Cualquier reclutador (recomendado)».
- **S4** (L1). History: «Contacto sin valores (recomendado)» — contact shows who/when/which field; every other field previous → new.
- **S5** (L1). Corrected CV per participation/record without deleting the candidate's original; the current CV is marked and the original stays downloadable (relayed by the frontend from the user's point 1: «el candidato postula con un cv incorrecto o desactualizado»).
- **S7** (L3). The vacancy board also shows corrections in this unit: «Sí, en esta unidad (recomendado)».
- **S6**. Concurrent edits are detected (ETag/If-Match); edits and their history commit atomically; nothing leaves the company (SRCH-7).

## Tasks

- T1 [done] S1-S7 | parent | Draft contract backend/docs/org-candidate-edits.md; frontend review. | commit: cdf3c12, c915bf4
- T2 [in progress] S2-S4, S6 | implementation writer; parent DB acceptance/review | E1 manual edits + history + etag implemented, DB execution pending (L5). | commit: -
- T3 [pending] S1-S4, S6 | TBD | E2 organic correction layer, effective values in list/detail/filters. | commit: -
- T4 [pending] S5, S6 | TBD | E3 corrected CV per participation. | commit: -
- T6 [pending] S7 | TBD | E4 vacancy board reads corrections (profile, contact, CV). | commit: -
- T5 [pending] S1-S7 | parent | Checks, native reviews, frontend QA, user review, merge. | commit: -

## Log

- **L1.** User decisions relayed verbatim by the frontend (2026-10-22): 1 «tu pregunta me hace pensar... y es que pasa mucho, que el candidato postula con un cv incorrecto o desactualizado oo tambien pasa que el candidato si tiene la experiencia requerida pero el cv no lo demuestra correctamwnte, y hay que hacer correcciones, y si pasa eso, realmebte cualquier dato del postulante debe poder modificarse, pero obviamente eso no va a modificar el perfil del candidato, me sigues?»; 2 «apoco los datos del candidato manual son distintos que los de el candidato organico?? deberian ser los mismos no?»; 3 «Cualquier reclutador (recomendado)»; 4 «Contacto sin valores (recomendado)»; 5 corrected CV included in this unit by the frontend from point 1 («Si te parece demasiado para v1, decime y lo partimos en un corte 2»).
- **L2.** Design note: history values (title, seniority, studies…) are company-private and go in a dedicated history table; shared `audit_events` metadata stays PII-free (board-filter-data privacy rule). Open point for the user: whether the vacancy board also shows corrections (recommended as a follow-up cut).
- **L3.** Frontend approved the contract and relayed the user's answer on the board (verbatim): «Sí, en esta unidad (recomendado)». Frontend adjustments applied: effective contact needs email or phone (`contact`/`required`, both kinds); 412 body is {error, code} and the client reloads with GET; history paginated (cursor, limit 20, max 50); E4 board shape (effective profile/name/contact, `corrected_fields`, detail `original`, `cv.source`, `original_cv`, `…/cv/original`).
- **L4.** User decisions before leaving (relayed verbatim by the frontend): merge — «Sí, mergeen sin esperarme (recomendado)»: when both branches are finished, full suites green and native reviews approved, merge to local main one at a time without waiting for the user's OK; never push (the user pushes). 412 conflict — «Se conserva y se muestra qué cambió (recomendado)»: UI-only (reload, keep the user's edited fields, mark fields the other recruiter also changed, save with the new etag); no contract change.
- **L5.** E1 implemented without commits: migration 00044, manual edits/history/strong ETag, atomic history+PII-free audit, additive detail including full six-key studies. Organic PATCH temporarily rejects with invalid_request and organic history is empty; E2–E4 remain pending. Observed RED: five absent-route/no-store checks, missing migration definition, language-order no-op, noncanonical cursor rejection. Focused/unit suites, both vet modes and archguard pass after schema-driven sqlc regeneration. DB HTTP, rollback, deterministic lock-wait concurrency and guarded Up/Down tests are authored/vetted but explicitly unexecuted here: parent owns DB acceptance using the commands in backend/docs/org-candidate-edits.md. Parent's uncommitted education contract addition and L4 were preserved.

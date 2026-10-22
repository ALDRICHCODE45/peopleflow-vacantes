# Org candidate edits (backend) — audited internal corrections

Cut 2 of «Candidatos de mi organización» (SRCH-4, AUD-1): every recruiter can correct any pool candidate; manual records are rewritten, organic candidates get a company-only correction layer; history and corrected CVs.
Branch feat/org-candidate-edits from main 3bd1e6f; frontend pairs on feat/org-candidate-edits-ui. Merge on user say, push by user.

## Specs

- **S1** (L1). Organic candidates are editable through a company-only correction layer: «cualquier dato del postulante debe poder modificarse, pero obviamente eso no va a modificar el perfil del candidato». Manual records are edited directly.
- **S2** (L1). Same editable fields for manual and organic: «apoco los datos del candidato manual son distintos que los de el candidato organico?? deberian ser los mismos no?» — contact (name, email, E.164 phone), location, title, current company, seniority, years, studies, languages, skills, links; manual-intake validation.
- **S3** (L1). Who edits: «Cualquier reclutador (recomendado)».
- **S4** (L1). History: «Contacto sin valores (recomendado)» — contact shows who/when/which field; every other field previous → new.
- **S5** (L1). Corrected CV per participation/record without deleting the candidate's original; the current CV is marked and the original stays downloadable (relayed by the frontend from the user's point 1: «el candidato postula con un cv incorrecto o desactualizado»).
- **S6**. Concurrent edits are detected (ETag/If-Match); edits and their history commit atomically; nothing leaves the company (SRCH-7).

## Tasks

- T1 [in_progress] S1-S6 | parent | Draft contract backend/docs/org-candidate-edits.md; frontend review. | commit: -
- T2 [pending] S2-S4, S6 | TBD | E1 manual edits + history + etag. | commit: -
- T3 [pending] S1-S4, S6 | TBD | E2 organic correction layer, effective values in list/detail/filters. | commit: -
- T4 [pending] S5, S6 | TBD | E3 corrected CV per participation. | commit: -
- T5 [pending] S1-S6 | parent | Checks, native reviews, frontend QA, user review, merge. | commit: -

## Log

- **L1.** User decisions relayed verbatim by the frontend (2026-10-22): 1 «tu pregunta me hace pensar... y es que pasa mucho, que el candidato postula con un cv incorrecto o desactualizado oo tambien pasa que el candidato si tiene la experiencia requerida pero el cv no lo demuestra correctamwnte, y hay que hacer correcciones, y si pasa eso, realmebte cualquier dato del postulante debe poder modificarse, pero obviamente eso no va a modificar el perfil del candidato, me sigues?»; 2 «apoco los datos del candidato manual son distintos que los de el candidato organico?? deberian ser los mismos no?»; 3 «Cualquier reclutador (recomendado)»; 4 «Contacto sin valores (recomendado)»; 5 corrected CV included in this unit by the frontend from point 1 («Si te parece demasiado para v1, decime y lo partimos en un corte 2»).
- **L2.** Design note: history values (title, seniority, studies…) are company-private and go in a dedicated history table; shared `audit_events` metadata stays PII-free (board-filter-data privacy rule). Open point for the user: whether the vacancy board also shows corrections (recommended as a follow-up cut).

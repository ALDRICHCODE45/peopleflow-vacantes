# Board filter data — screening answers and profile snapshot — frontend

Frontend of backend §19 (`docs/pipeline-customization-design.md` in the backend repo
`/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes`, branch `feat/pipeline-filter-data`).
Branch `feat/pipeline-filter-data-ui`, stacked on `feat/pipeline-column-editing-ui`.

## Specs

- S1. User answers (verbatim): «Sí/No, opción única y múltiple», then after the backend explained that multiple choice does not exist yet: «Opción única ahora; múltiple después (Recomendado)». Filter by single-choice screening answers (Sí/No included); «Sin respuesta» value `none`.
- S2. User answers (verbatim): «Ubicación (estado/ciudad)», «Habilidades», «Años de experiencia», «Nivel de estudios»; then «Copiar datos del perfil al postular (Recomendado)» and «Filtrar por ciudad ahora (Recomendado)». Profile snapshot copied at apply time, shown in the candidate sheet and used to filter; only the vacancy's recruiters; earlier applications show «Sin dato».
- S3. Contract §19: board items gain `screening_answers:[{question_id, option_id}]` and `profile:{city|null, skills[], years_of_experience|null, education_level: high_school|bachelor|master|phd|null}`; board root gains `screening_filters:[{question_id, prompt, options:[{id,label}]}]` in questionnaire order; participation detail gains `profile`. Mutation responses (move/substate/discard/recover) never carry `profile`/`screening_answers`: keep them from the board item. Client dimensions: city (value = casefold of normalized city, label = first seen), skills (same normalization), experience buckets [0,1) [1,3) [3,5) [5,∞), education level; each with «Sin dato» (`none`); options derived from board items; an answer whose question/option no longer exists matches nothing; no answer → `none`.
- S4. UI rules: docs/frontend-ui-design-rules.md (all; §13.12 and §17 for filters, §16 comparable structures, §19 official shadcn composition). Never invent data; strict decoders.

## Tasks

- T1 [pending] S1-S4 | writer | Decoders + new filter dimensions (one per screening question and profile fields) in the Filtros Sheet sections + profile block in the candidate sheet. | commit: -
- T2 [pending] | parent | Verify against the backend branch when it lands, guide step, queue item. | commit: -

## Log

- L1. Answers gathered 2026-10-19 before the user went to sleep; contract §19 accepted by the frontend (mutations never carry the two keys).

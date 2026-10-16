# Pipeline customization

Backend side of per-vacancy pipeline customization, delivered cut by cut with the frontend agent.
Branch `feat/pipeline-config` (from main a39e5ca). Design: `docs/pipeline-customization-design.md`. Business rules: `docs/recruitment-business-rules.md` §5, §5.1, §6.

## Specs

- **S1.** «quiero que lo hagamos lento porque tengo prisa, me explico? a nuestro paso, tranquilos, disenando todo bien, entre tu y el agente del frontend, deben coordinarse para sacar feature a feature de forma rapida pero segura.»
- **S2.** «Si hermano, arrancamos ya con eso.» — approved start of step 0: joint design of the model and contract for cut 1 with the frontend agent, no code.
- **S3.** Delivery rules in force: no PRs; local merge to `main` only after the user's real browser test; the user pushes.

## Tasks

- [ ] T1 — S1, S2: design proposal `docs/pipeline-customization-design.md` (inline) — commit pending
- [ ] T2 — S1, S2: contract review with frontend agent (intercom) — pending
- [ ] T3 — S2: user answers product questions Q1–Q3 — pending
- [ ] T4 — S1: close the cut-1 contract and open cut-1 implementation tasks — pending

## Log

- **L1.** User (2026-10-15): «Si hermano, creo que lo que hay que tomar ahora es el tema de la personalizacion del pipeline, y esto es algo que va a requerir mucho trabajo, porque lo tenemos todo documentado, y quiero que lo hagamos lento porque tengo prisa, me explico? a nuestro paso, tranquilos, disenando todo bien, entre tu y el agente del frontend, deben coordinarse para sacar feature a feature de forma rapida pero segura. sabes de que te hablo? ya tienes ubicado la documentacion donde se encuentran todas las desiciones que tomamos?»
- **L2.** User (2026-10-15): «Si hermano, arrancamos ya con eso. por favor.» (after the 0–7 cut plan was proposed).
- **L3.** Evidence: the only employer vacancy entity is `job_drafts`; no draft→publish path; drafts lack cutoff/target/commitment; `applications.status` fixed CHECK (00010). Cut 1 attaches configuration to the draft. Draft GET/PATCH authorization (owner or principal) matches who may change pipeline configuration.

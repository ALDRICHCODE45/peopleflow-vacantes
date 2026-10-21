# Recruiter manual intake (UI) and preparatory cleanup

Frontend side of two stacked cuts agreed with the user on 2026-10-21: (A) cleanup of known
divergences and the close reason, (B) recruiter manual candidate intake (INT-*). Branches
`feat/intake-prep-ui` (A) from main 4a82437, then `feat/manual-intake-ui` (B) stacked on A.
Backend counterpart: session 01a15cf9-39e8. Nothing merges to main without the user's word.

## Specs

- **S1** (INT-17). «CV is mandatory for **organic candidate applications as well**. Remove the employer setting that permits applications without CV; it must not remain a configurable exemption.»
- **S2** (SRCH-1, user L2). «Quitar beneficios del filtro público»: the three visual-only benefits leave `/vacantes`.
- **S3** (VAC-5/7, user L2). «La vacante reanudada conserva su fecha de publicación original; las pausas quedan en su historial.»
- **S4** (VAC-9, user L2). Close reason «"Cubierta", "Cancelada" u "Otro" (con texto) en el diálogo de cerrar; se ve en la lista y en el historial.» Mandatory.
- **S5** (INT-1, INT-3, INT-6, user L2). «"Agregar candidato" en el tablero de la vacante; entra en la primera etapa por defecto y se puede elegir otra activa (nunca Placement).» No account needed, no notification, no candidate-facing entry.
- **S6** (INT-7, INT-8, INT-9, INT-10, INT-11, user L2). Required: name, education level, contact (email or telephone, both allowed), residence and CV. «País obligatorio; en México estado y municipio obligatorios, CP opcional. Teléfono con lada de país (+52 y 10 dígitos en México). Sin fecha de nacimiento (PRIV-1).» Other profile fields optional, same as the candidate profile UI.
- **S7** (INT-14, user L2). «Compara con candidatos que ya pasaron por tu empresa. Avisa antes de guardar: "Usar el existente" o "Es otra persona, crear". Nunca fusiona solo y no revela cuentas de otras empresas.»
- **S8** (user L2). «Badge de origen en la tarjeta y en la ficha "Agregado por Ana Pérez el 21 oct"; nunca dice "postuló". Sin notificación al candidato (INT-3).» Label «Ingreso manual».
- **S9** (INT-12/16, user L2). Prefill from CV/LinkedIn/OCC is out of this cut: manual entry only.
- **S10** (user L2/L3). Overnight mode: stacked branches, browser QA of function **and** design, review queue; merge only on the user's word, push by the user.

## Tasks

- [x] T1 — S1–S4: agree contracts with the backend (setting removal, resume date, close reason) — route: intercom — commit: —
- [x] T2 — S1, S2: remove «Permitir postulaciones sin CV» and the public benefit filters — route: inline — commit: —
- [ ] T3 — S3, S4: close reason in the close dialog, list and history; resume keeps the publication date — route: inline/worker — commit: —
- [ ] T4 — S5–S9: agree the manual-intake contract with the backend — route: intercom — commit: —
- [ ] T5 — S5–S8: «Agregar candidato» form (Sheet), duplicate check, origin badge — route: worker — commit: —
- [ ] T6 — S10: browser QA (function + design), docs, review queue — route: inline — commit: —

## Log

- **L1.** User: «si hermano, adelante, pero yo recuerdo que hay bastantes cosas mas, … los reclutadores podian ingresar manualmente a un candidato en el proceso de una vacante sin necesidad de que un candidato postulara (es decir, no tiene que existir en el sistema, ingresa los datos del candidato manualmente, me explico?) tambien recuerdo haber platicado algo sobre un apartado en donde los reclutadores puedan buscar candidatos para sacar curricula … preguntale al backend». Backend inventory received (memory plan/pending-inventory); recommended order: cleanup, then manual intake, then talent pool/search.
- **L2.** User: «si hermano, por favor, inicia con lo que creas conveniente, coordinate con el backend para hacer esta nueva feature, … recuerda usar tu systema design, priorizar shadcn, y cuando pruebas las funcionalidades en el navegador, no solamente pruebes que "funcione", ve la ui, ve si algo se rompe, si algo no se ve bien, si algo no sigue tu system design, haz redisenos de ser necesario». Answers: entry «Botón en el tablero, elige etapa»; duplicates «Solo mi organización»; validation «País + estado/municipio en MX; tel con lada»; origin «"Ingreso manual" + quién lo cargó»; cleanup: all three; close reason «Sí, obligatorio en el diálogo»; prefill «Fuera por ahora, solo carga manual»; mode «Sí: ramas apiladas, nada a main».
- **L3.** Backend contract A (feat/intake-prep from main 4a82437), accepted: INT-17 setting is UI-only (v2 apply already requires CV). `published_at` = first publication; neither resume nor reopen renew it; migration 00035 restores existing rows. Close body strict `{"process":"continue"|"finish","reason":"filled"|"cancelled"|"other","reason_note":string|null}` (note required, trimmed, ≤200 code points only with other; null otherwise; shape errors 400 invalid_request). VAC-9 extra rule «`Cubierta` is allowed only when the required positions are filled»: filled needs coverage.required != null and covered >= required, else 422 `close_reason_not_covered` with data {"covered":N,"required":N|null}, no writes. Reads: lifecycle view (GET + embedded in editor/board/pipeline) adds `close_reason`, `close_reason_note` (current closure only, else null); history items add `reason`, `reason_note`; company list adds `close_reason`, `close_reason_note`. Pre-migration closures have null reason → UI «Sin motivo registrado». UI: «Cubierta» disabled with an explanation when coverage is insufficient; a 422 shows the same text and reloads.
- **L4.** User: «Perfecto hermano, entonces si ya tienes manera de entrar como empresa y como candidato, no hay problema, me voy a dormir tranquilo, adelante.» Agent manages the dev servers (Postgres container stays up).
- **L5.** T2: `JobsVisualPreferences` (language + the three benefits) was already unmounted since the salary cut; the dead component and its test are deleted, so no benefit filter remains (S2). «Permitir postulaciones sin CV» removed from Configuración → Reclutamiento (RED: new INT-17 test failed, then GREEN); the preference test now uses «Incluir preguntas de filtro». employer-settings + jobs 3158/3158, tsc, eslint clean.
